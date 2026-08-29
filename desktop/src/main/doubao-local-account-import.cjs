"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {AUTH_COOKIE_PATTERN} = require("./doubao-login-state.cjs");
const {normalizeAccounts} = require("./doubao-account-registry.cjs");

const DOUBAO_URLS = ["https://www.doubao.com/chat/", "https://www.dola.com/chat/"];
const DOUBAO_COOKIE_DOMAIN = /(?:^|\.)(?:doubao\.com|dola\.com)$/i;
const COOKIE_SAME_SITE = new Set(["unspecified", "no_restriction", "lax", "strict"]);

function safePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function partitionFor(tenantId, accountId) {
  return `persist:lingframe_${safePart(tenantId)}_doubao_${safePart(accountId)}`;
}

function isDoubaoAuthCookie(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "");
  return AUTH_COOKIE_PATTERN.test(String(cookie?.name || "")) && Boolean(String(cookie?.value || "")) && DOUBAO_COOKIE_DOMAIN.test(domain);
}

function cookieIdentity(cookie) {
  return `${String(cookie?.domain || "").toLowerCase()}|${String(cookie?.path || "/")}|${String(cookie?.name || "").toLowerCase()}`;
}

function cookieUrl(cookie) {
  const domain = String(cookie?.domain || "").replace(/^\./, "");
  const cookiePath = String(cookie?.path || "/");
  if (!DOUBAO_COOKIE_DOMAIN.test(domain)) throw new Error("豆包登录凭证域名无效");
  return `${cookie?.secure === false ? "http" : "https"}://${domain}${cookiePath.startsWith("/") ? cookiePath : "/"}`;
}

function cookieSetDetails(cookie) {
  const details = {
    url: cookieUrl(cookie),
    name: String(cookie.name || ""),
    value: String(cookie.value || ""),
    path: String(cookie.path || "/"),
    secure: cookie.secure !== false,
    httpOnly: cookie.httpOnly === true,
  };
  if (cookie.domain) details.domain = String(cookie.domain);
  if (Number.isFinite(Number(cookie.expirationDate)) && Number(cookie.expirationDate) > 0) details.expirationDate = Number(cookie.expirationDate);
  const sameSite = String(cookie.sameSite || "").toLowerCase();
  if (COOKIE_SAME_SITE.has(sameSite)) details.sameSite = sameSite;
  return details;
}

function readAccounts(tenantRoot) {
  try {
    const state = JSON.parse(fs.readFileSync(path.join(tenantRoot, "database", "doubao-accounts-v1.json"), "utf8"));
    return normalizeAccounts(state?.accounts);
  } catch {
    return [];
  }
}

function inferProfileAccounts(tenantRoot) {
  const values = [];
  for (const directory of [path.join(tenantRoot, "embedded-browser-profiles"), path.join(tenantRoot, "chrome-profiles")]) {
    try {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        if (!entry.isDirectory()) continue;
        const match = entry.name.match(/^account_(.+)$/);
        const id = match ? match[1] : entry.name;
        values.push({id, name: id, platform: "豆包"});
      }
    } catch {}
  }
  return normalizeAccounts(values);
}

class DoubaoLocalAccountImport {
  constructor({tenantsRootProvider, currentTenantProvider, sessionProvider, accountRegistry, refFactory = null}) {
    if (typeof tenantsRootProvider !== "function" || typeof currentTenantProvider !== "function") throw new Error("本机账号迁移缺少租户上下文");
    if (typeof sessionProvider !== "function") throw new Error("本机账号迁移缺少浏览器会话提供器");
    this.tenantsRootProvider = tenantsRootProvider;
    this.currentTenantProvider = currentTenantProvider;
    this.sessionProvider = sessionProvider;
    this.accountRegistry = accountRegistry;
    this.refFactory = refFactory || (() => crypto.randomBytes(18).toString("base64url"));
    this.candidates = new Map();
  }

  currentTenantId() {
    const tenantId = String(this.currentTenantProvider() || "").trim();
    if (!tenantId) throw new Error("授权未生效，无法加载本机豆包账号");
    return tenantId;
  }

  async authCookies(browserSession) {
    const collected = [];
    const seen = new Set();
    for (const url of DOUBAO_URLS) {
      let cookies = [];
      try { cookies = await browserSession.cookies.get({url}); } catch {}
      for (const cookie of Array.isArray(cookies) ? cookies : []) {
        if (!isDoubaoAuthCookie(cookie)) continue;
        const identity = cookieIdentity(cookie);
        if (seen.has(identity)) continue;
        seen.add(identity);
        collected.push(cookie);
      }
    }
    return collected;
  }

  async discover() {
    const currentTenantId = this.currentTenantId();
    const tenantsRoot = path.resolve(this.tenantsRootProvider());
    const existingIds = new Set((this.accountRegistry?.list?.() || []).map(account => String(account.id)));
    const discovered = [];
    this.candidates.clear();
    let tenantEntries = [];
    try { tenantEntries = fs.readdirSync(tenantsRoot, {withFileTypes: true}); } catch { return []; }
    for (const tenantEntry of tenantEntries) {
      if (!tenantEntry.isDirectory() || tenantEntry.name === currentTenantId) continue;
      const tenantRoot = path.join(tenantsRoot, tenantEntry.name);
      const registryAccounts = readAccounts(tenantRoot);
      const namedAccounts = new Map(registryAccounts.map(account => [account.id, account]));
      const accounts = normalizeAccounts([...registryAccounts, ...inferProfileAccounts(tenantRoot)]);
      for (const rawAccount of accounts) {
        if (existingIds.has(rawAccount.id)) continue;
        const account = namedAccounts.get(rawAccount.id) || rawAccount;
        const sourcePartition = partitionFor(tenantEntry.name, account.id);
        const cookies = await this.authCookies(this.sessionProvider(sourcePartition));
        if (!cookies.length) continue;
        let updatedAt = 0;
        try { updatedAt = fs.statSync(path.join(tenantRoot, "embedded-browser-profiles", account.id)).mtimeMs; } catch {}
        discovered.push({account, sourcePartition, sourceTenantId: tenantEntry.name, updatedAt});
      }
    }
    discovered.sort((left, right) => right.updatedAt - left.updatedAt);
    const uniqueIds = new Set();
    const result = [];
    for (const candidate of discovered) {
      if (uniqueIds.has(candidate.account.id)) continue;
      uniqueIds.add(candidate.account.id);
      const ref = this.refFactory();
      this.candidates.set(ref, {...candidate, targetTenantId: currentTenantId});
      result.push({ref, accountId: candidate.account.id, name: candidate.account.name, platform: "豆包", loginState: "logged_in"});
    }
    return result;
  }

  async replaceAuthCookies(browserSession, cookies) {
    const current = await this.authCookies(browserSession);
    for (const cookie of current) await browserSession.cookies.remove(cookieUrl(cookie), cookie.name);
    for (const cookie of cookies) await browserSession.cookies.set(cookieSetDetails(cookie));
    await browserSession.flushStorageData?.();
  }

  async importCandidate(ref) {
    const candidate = this.candidates.get(String(ref || ""));
    const currentTenantId = this.currentTenantId();
    if (!candidate || candidate.targetTenantId !== currentTenantId) {
      const error = new Error("本机账号候选已失效，请重新扫描");
      error.code = "DOUBAO_LOCAL_ACCOUNT_CANDIDATE_EXPIRED";
      throw error;
    }
    const existing = this.accountRegistry?.resolve?.(candidate.account.id);
    if (existing) {
      this.candidates.delete(String(ref));
      return {ok: true, status: "exists", account: existing};
    }
    const sourceSession = this.sessionProvider(candidate.sourcePartition);
    const sourceCookies = await this.authCookies(sourceSession);
    if (!sourceCookies.length) {
      const error = new Error(`账号“${candidate.account.name}”的本机登录已失效，请重新登录`);
      error.code = "DOUBAO_LOCAL_ACCOUNT_LOGIN_EXPIRED";
      throw error;
    }
    const targetPartition = partitionFor(currentTenantId, candidate.account.id);
    const targetSession = this.sessionProvider(targetPartition);
    const previousCookies = await this.authCookies(targetSession);
    const currentRoot = path.join(path.resolve(this.tenantsRootProvider()), currentTenantId);
    const markerDir = path.join(currentRoot, "embedded-browser-profiles", candidate.account.id);
    const markerFile = path.join(markerDir, "partition.txt");
    const markerExisted = fs.existsSync(markerFile);
    const previousMarker = markerExisted ? fs.readFileSync(markerFile, "utf8") : "";
    let registryWritten = false;
    try {
      await this.replaceAuthCookies(targetSession, sourceCookies);
      const verified = await this.authCookies(targetSession);
      if (!verified.length) throw new Error("新工作区未能写入豆包登录凭证");
      fs.mkdirSync(markerDir, {recursive: true});
      fs.writeFileSync(markerFile, targetPartition, {encoding: "utf8", mode: 0o600});
      const account = this.accountRegistry.upsert(candidate.account);
      registryWritten = true;
      this.candidates.delete(String(ref));
      return {ok: true, status: "imported", account};
    } catch (error) {
      try { await this.replaceAuthCookies(targetSession, previousCookies); } catch {}
      if (registryWritten || this.accountRegistry?.resolve?.(candidate.account.id)) {
        try { this.accountRegistry.remove(candidate.account.id); } catch {}
      }
      try {
        if (markerExisted) fs.writeFileSync(markerFile, previousMarker, "utf8");
        else if (fs.existsSync(markerFile)) fs.unlinkSync(markerFile);
        if (!markerExisted && fs.existsSync(markerDir) && fs.readdirSync(markerDir).length === 0) fs.rmdirSync(markerDir);
      } catch {}
      const wrapped = new Error(`加载账号“${candidate.account.name}”失败：${String(error?.message || error)}`);
      wrapped.code = error?.code || "DOUBAO_LOCAL_ACCOUNT_IMPORT_FAILED";
      throw wrapped;
    }
  }
}

module.exports = {
  DoubaoLocalAccountImport,
  DOUBAO_URLS,
  partitionFor,
  isDoubaoAuthCookie,
  cookieSetDetails,
};
