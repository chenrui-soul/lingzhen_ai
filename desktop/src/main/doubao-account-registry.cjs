"use strict";

const fs = require("fs");
const path = require("path");

const LEGACY_PLACEHOLDER_IDS = new Set(["desktop-1", "desktop-2", "desktop-3"]);
const ACCOUNT_IN_USE_TASK_STATES = new Set([
  "queued", "preparing", "assigned", "launching", "checking_login", "uploading",
  "configuring", "submitting", "awaiting_confirmation", "generating", "downloading",
  "verifying", "awaiting_login", "awaiting_verification", "awaiting_quota",
  "submission_unknown", "paused",
]);

function normalizeAccount(value) {
  const source = value && typeof value === "object" ? value : {};
  const id = String(source.id || source.accountId || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(id)) return null;
  const name = String(source.name || source.accountName || id).trim().slice(0, 100) || id;
  const account = {id, name, platform: "豆包"};
  if (["unknown", "logged_in", "logged_out", "verification_required"].includes(source.loginState)) account.loginState = source.loginState;
  if (source.loginSummary) account.loginSummary = String(source.loginSummary).trim().slice(0, 300);
  if (source.lastCheckedAt && Number.isFinite(Date.parse(String(source.lastCheckedAt)))) account.lastCheckedAt = String(source.lastCheckedAt);
  return account;
}

function normalizeAccounts(values, {excludeLegacyPlaceholders = false} = {}) {
  const output = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const account = normalizeAccount(value);
    if (!account || seen.has(account.id)) continue;
    if (excludeLegacyPlaceholders && LEGACY_PLACEHOLDER_IDS.has(account.id)) continue;
    seen.add(account.id);
    output.push(account);
    if (output.length >= 50) break;
  }
  return output;
}

class DoubaoAccountRegistry {
  constructor({tenantRootProvider, tenantIdProvider = null, userIdProvider = null, changeListener = null}) {
    if (typeof tenantRootProvider !== "function") throw new Error("tenantRootProvider 必须是函数");
    this.tenantRootProvider = tenantRootProvider;
    this.tenantIdProvider = typeof tenantIdProvider === "function" ? tenantIdProvider : null;
    this.userIdProvider = typeof userIdProvider === "function" ? userIdProvider : () => null;
    this.changeListener = typeof changeListener === "function" ? changeListener : null;
  }
  root() {
    const root = this.tenantRootProvider();
    if (!root) throw new Error("桌面身份尚未验证，无法访问豆包账号");
    const resolved = path.resolve(root);
    fs.mkdirSync(path.join(resolved, "database"), {recursive: true});
    return resolved;
  }
  tenantId() { return String(this.tenantIdProvider?.() || path.basename(this.root())); }
  userId() { return String(this.userIdProvider?.() || ""); }
  setChangeListener(listener) { this.changeListener = typeof listener === "function" ? listener : null; }
  file() { return path.join(this.root(), "database", "doubao-accounts-v1.json"); }
  read() {
    const file = this.file();
    try {
      const value = JSON.parse(fs.readFileSync(file, "utf8"));
      const ownerUserId = String(value?.ownerUserId || "");
      if (ownerUserId && ownerUserId !== this.userId()) return {exists: false, accounts: []};
      return {exists: true, accounts: normalizeAccounts(value?.accounts), ownerUserId};
    } catch (error) {
      if (error.code !== "ENOENT") {
        try { fs.copyFileSync(file, `${file}.broken-${Date.now()}`); } catch {}
      }
      return {exists: false, accounts: []};
    }
  }
  save(accounts, event = null) {
    const file = this.file();
    const state = {version: 2, tenantId: this.tenantId(), ownerUserId: this.userId(), accounts: normalizeAccounts(accounts), updatedAt: new Date().toISOString()};
    const temporary = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(state, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(temporary, file);
    try { fs.chmodSync(file, 0o600); } catch {}
    try { this.changeListener?.(event || {type:"replace", accounts:state.accounts}); } catch {}
    return state.accounts;
  }
  inferExistingAccounts() {
    const root = this.root();
    const ids = new Set();
    for (const directory of [path.join(root, "embedded-browser-profiles"), path.join(root, "chrome-profiles")]) {
      try {
        for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
          if (!entry.isDirectory()) continue;
          const match = entry.name.match(/^account_(.+)$/);
          ids.add(match ? match[1] : entry.name);
        }
      } catch {}
    }
    const names = new Map();
    try {
      const workbench = JSON.parse(fs.readFileSync(path.join(root, "database", "workbench-data-v1.json"), "utf8"));
      for (const task of Array.isArray(workbench.tasks) ? workbench.tasks : []) {
        const id = String(task.accountId || "").trim();
        if (id && task.accountName && !names.has(id)) names.set(id, String(task.accountName));
        for (const candidate of Array.isArray(task.accountCandidates) ? task.accountCandidates : []) {
          const candidateId = String(candidate?.id || "").trim();
          if (ids.has(candidateId) && candidate?.name && !names.has(candidateId)) names.set(candidateId, String(candidate.name));
        }
      }
    } catch {}
    return [...ids].map(id => ({id, name:names.get(id) || id, platform:"豆包"}));
  }
  bootstrap(input = {}) {
    const current = this.read();
    const accounts = current.exists ? current.accounts : normalizeAccounts([
      ...this.inferExistingAccounts(),
      ...normalizeAccounts(input.legacyAccounts, {excludeLegacyPlaceholders: true}),
    ]);
    if (!current.exists || !current.ownerUserId) this.save(accounts);
    return {tenantId: this.tenantId(), userId:this.userId(), accounts};
  }
  list() { return this.read().accounts; }
  upsert(input = {}) {
    const account = normalizeAccount(input);
    if (!account) throw Object.assign(new Error("豆包账号资料无效"), {code: "DOUBAO_ACCOUNT_INVALID"});
    const accounts = this.list();
    const index = accounts.findIndex(item => item.id === account.id);
    if (index >= 0) accounts[index] = account; else accounts.push(account);
    this.save(accounts, {type:"upsert", account});
    return account;
  }
  remove(accountId) {
    const id = String(accountId || "").trim();
    const accounts = this.list();
    const next = accounts.filter(item => item.id !== id);
    if (next.length === accounts.length) return {ok: true, removed: false, accountId: id};
    this.save(next, {type:"remove", accountId:id});
    return {ok: true, removed: true, accountId: id};
  }
  assertRemovable(accountOrId, tasks = []) {
    const account = this.assert(accountOrId);
    const activeTasks = (Array.isArray(tasks) ? tasks : []).filter(task =>
      task && !task.deletedAt && task.executionChannel === "doubao" &&
      String(task.accountId || "") === account.id && ACCOUNT_IN_USE_TASK_STATES.has(String(task.state || ""))
    );
    if (activeTasks.length) {
      const error = new Error(`账号“${account.name}”仍有 ${activeTasks.length} 个任务未结束，请先取消或处理这些任务后再删除账号`);
      error.code = "DOUBAO_ACCOUNT_IN_USE";
      error.accountId = account.id;
      error.taskIds = activeTasks.map(task => String(task.id || "")).filter(Boolean);
      error.tasks = activeTasks.slice(0, 10).map(task => ({id: task.id, title: task.title, state: task.state}));
      throw error;
    }
    return account;
  }
  resolve(accountOrId) {
    const id = String(typeof accountOrId === "object" ? accountOrId?.id || accountOrId?.accountId : accountOrId || "").trim();
    return this.list().find(item => item.id === id) || null;
  }
  assert(accountOrId) {
    const requestedId = String(typeof accountOrId === "object" ? accountOrId?.id || accountOrId?.accountId : accountOrId || "").trim();
    const account = this.resolve(requestedId);
    if (account) return account;
    const error = new Error(requestedId ? "当前用户无权使用该豆包账号" : "请选择当前用户下的豆包账号");
    error.code = "DOUBAO_ACCOUNT_NOT_AUTHORIZED";
    error.accountId = requestedId;
    throw error;
  }
  filterCandidates(values = []) {
    const allowed = new Map(this.list().map(item => [item.id, item]));
    const output = [];
    const seen = new Set();
    for (const candidate of normalizeAccounts(values)) {
      const account = allowed.get(candidate.id);
      if (!account || seen.has(account.id)) continue;
      seen.add(account.id);
      output.push(account);
    }
    return output;
  }
}

module.exports = {DoubaoAccountRegistry, normalizeAccount, normalizeAccounts, LEGACY_PLACEHOLDER_IDS, ACCOUNT_IN_USE_TASK_STATES};
