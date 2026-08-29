"use strict";

const {BrowserWindow, shell, session} = require("electron");
const fs = require("fs");
const path = require("path");
const {DOUBAO_LOGIN_PROBE_EXPRESSION, classifyDoubaoLoginState, hasDecisivePageLoginSignal} = require("./doubao-login-state.cjs");
const {DoubaoLocalAccountImport} = require("./doubao-local-account-import.cjs");

const SAFE_WINDOW = {width: 1280, height: 860, minWidth: 1080, minHeight: 720};
const TERMINAL_TASK_STATES = new Set(["completed", "failed", "cancelled"]);

function safePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function isDoubaoUrl(url) {
  return /^https:\/\/(?:www\.)?(?:doubao\.com|dola\.com)(?:\/|$)/i.test(String(url || ""));
}

class EmbeddedBrowserManager {
  constructor({window, tenantProvider, dataRootProvider, tenantsRootProvider = null, accountRegistry = null, browserWindowFactory = null, sessionProvider = null}) {
    this.window = window;
    this.tenantProvider = tenantProvider;
    this.dataRootProvider = dataRootProvider;
    this.browserWindowFactory = browserWindowFactory || (options => new BrowserWindow(options));
    this.localAccountImport = tenantsRootProvider && accountRegistry ? new DoubaoLocalAccountImport({
      tenantsRootProvider,
      currentTenantProvider: tenantProvider,
      sessionProvider: sessionProvider || (partition => session.fromPartition(partition)),
      accountRegistry,
    }) : null;
    this.sessions = new Map();
    this.activeAccountId = "";
    this.pageActive = false;
    this.requestedBounds = {x: 0, y: 0, width: 0, height: 0};
    this.disposing = false;
  }

  accountId(account) {
    const id = account && (account.id || account.accountId);
    if (!id) throw new Error("豆包账号缺少账号 ID");
    return safePart(id);
  }

  partitionFor(account) {
    const tenant = this.tenantProvider && this.tenantProvider();
    if (!tenant) throw new Error("授权未生效，不能创建豆包账号环境");
    return `persist:lingframe_${safePart(tenant)}_doubao_${this.accountId(account)}`;
  }

  platformUrl(account) {
    return String(account && account.platform || "豆包").toLowerCase() === "dola"
      ? "https://www.dola.com/chat/" : "https://www.doubao.com/chat/";
  }

  windowTitle(item) {
    const accountName = item.account.name || item.id;
    const running = item.activeTaskIds.size;
    const state = item.lastTask?.statusText || item.lastTask?.state || "账号工作窗口";
    return running ? `豆包实时任务现场 · ${accountName} · ${state}` : `豆包账号 · ${accountName}`;
  }

  createSession(account) {
    const id = this.accountId(account);
    const tenantId = String(this.tenantProvider && this.tenantProvider() || "");
    const existing = this.sessions.get(id);
    if (existing && existing.tenantId !== tenantId) {
      try { existing.window.destroy(); } catch {}
      this.sessions.delete(id);
    }
    const current = this.sessions.get(id);
    if (current && !current.window.isDestroyed()) {
      current.account = {...current.account, ...account, id};
      current.window.setTitle(this.windowTitle(current));
      return current;
    }
    const partition = this.partitionFor(account);
    const dataRoot = this.dataRootProvider && this.dataRootProvider();
    if (dataRoot) {
      const markerDir = path.join(dataRoot, "embedded-browser-profiles", id);
      fs.mkdirSync(markerDir, {recursive: true});
      fs.writeFileSync(path.join(markerDir, "partition.txt"), partition, "utf8");
    }
    const index = this.sessions.size;
    const mainBounds = this.window && !this.window.isDestroyed() ? this.window.getBounds() : {x: 80, y: 60};
    const worker = this.browserWindowFactory({
      width: SAFE_WINDOW.width,
      height: SAFE_WINDOW.height,
      minWidth: SAFE_WINDOW.minWidth,
      minHeight: SAFE_WINDOW.minHeight,
      x: Math.max(0, Number(mainBounds.x || 0) + 42 + (index % 4) * 34),
      y: Math.max(0, Number(mainBounds.y || 0) + 42 + (index % 4) * 34),
      show: false,
      frame: true,
      resizable: true,
      movable: true,
      minimizable: true,
      maximizable: true,
      autoHideMenuBar: true,
      backgroundColor: "#070d19",
      title: `豆包账号 · ${account.name || id}`,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        backgroundThrottling: false,
      },
    });
    worker.setMenuBarVisibility?.(false);
    const webContents = worker.webContents;
    const item = {
      id,
      tenantId,
      account: {...account, id},
      partition,
      window: worker,
      webContents,
      view: null,
      activeTaskIds: new Set(),
      taskEpoch: 0,
      lastTask: null,
      lastLoginState: null,
      closeProtected: false,
    };
    this.sessions.set(id, item);
    webContents.setWindowOpenHandler(({url}) => {
      if (isDoubaoUrl(url)) return {action: "allow"};
      shell.openExternal(url);
      return {action: "deny"};
    });
    webContents.on("did-navigate", () => this.emitStatus(id));
    webContents.on("did-finish-load", () => this.emitStatus(id));
    webContents.on("render-process-gone", (_event, details) => {
      this.emitStatus(id, {error: `豆包页面进程已退出：${details.reason || "unknown"}`});
    });
    worker.on("close", event => {
      if (this.disposing || !item.activeTaskIds.size) return;
      event.preventDefault();
      item.closeProtected = true;
      worker.hide();
      this.emitStatus(id, {closeProtected: true, message: "任务仍在执行，窗口已隐藏到任务坞；浏览器环境没有关闭"});
    });
    worker.on("closed", () => {
      if (this.sessions.get(id) === item) this.sessions.delete(id);
      if (this.activeAccountId === id) this.activeAccountId = "";
      this.emitStatus(id, {closed: true});
    });
    worker.on("show", () => this.emitStatus(id));
    worker.on("hide", () => this.emitStatus(id));
    worker.on("minimize", () => this.emitStatus(id));
    worker.on("restore", () => this.emitStatus(id));
    return item;
  }

  emitStatus(id, extra = {}) {
    const item = this.sessions.get(id);
    if (!this.window || this.window.isDestroyed()) return;
    this.window.webContents.send("doubao:embedded-status", {
      accountId: id,
      url: item?.webContents.getURL() || "",
      loaded: item ? !item.webContents.isLoading() : false,
      visible: item ? item.window.isVisible() : false,
      minimized: item ? item.window.isMinimized() : false,
      activeTaskIds: item ? [...item.activeTaskIds] : [],
      floating: true,
      ...extra,
    });
  }

  ensureSafeWindow(item) {
    if (!item || item.window.isDestroyed()) return;
    const [width, height] = item.window.getSize();
    if (width < SAFE_WINDOW.minWidth || height < SAFE_WINDOW.minHeight) {
      item.window.setSize(Math.max(width, SAFE_WINDOW.width), Math.max(height, SAFE_WINDOW.height));
    }
  }

  show(item, {focus = false} = {}) {
    if (!item || item.window.isDestroyed()) return;
    this.ensureSafeWindow(item);
    if (item.window.isMinimized()) item.window.restore();
    if (focus) {
      item.window.show();
      item.window.focus();
    } else if (!item.window.isVisible()) item.window.showInactive();
    item.window.setTitle(this.windowTitle(item));
    this.activeAccountId = item.id;
    this.emitStatus(item.id);
  }

  async ensureLoaded(item) {
    if (!item.webContents.getURL()) await item.webContents.loadURL(this.platformUrl(item.account));
    return item;
  }

  async open(account, options = {}) {
    const item = this.createSession(account);
    const taskEpoch = Number(item.taskEpoch || 0);
    const hadActiveTask = item.activeTaskIds.size > 0;
    await this.ensureLoaded(item);
    if (!hadActiveTask && Number(item.taskEpoch || 0) !== taskEpoch) {
      this.emitStatus(item.id, {openSuppressed: true, reason: "automation-started"});
      return this.status(item.id);
    }
    this.show(item, {focus: options.focus !== false});
    return this.status(item.id);
  }

  async automationSession(account) {
    const item = await this.ensureLoaded(this.createSession(account));
    return item;
  }

  async beginTask(account, task = {}) {
    const item = await this.ensureLoaded(this.createSession(account));
    const taskId = String(task.id || task.taskId || "").trim();
    if (taskId) item.activeTaskIds.add(taskId);
    item.taskEpoch = Number(item.taskEpoch || 0) + 1;
    item.lastTask = {...task, id: taskId || task.id};
    item.window.setTitle(this.windowTitle(item));
    item.closeProtected = false;
    item.window.flashFrame?.(false);
    if (item.window.isVisible()) item.window.hide();
    this.emitStatus(item.id, {taskStarted: taskId || null});
    return this.status(item.id);
  }

  updateTask(task = {}) {
    const id = safePart(task.accountId || "");
    const item = this.sessions.get(id);
    if (!item || item.window.isDestroyed()) return null;
    const taskId = String(task.id || task.taskId || "").trim();
    if (taskId && !TERMINAL_TASK_STATES.has(task.state)) item.activeTaskIds.add(taskId);
    if (taskId && TERMINAL_TASK_STATES.has(task.state)) item.activeTaskIds.delete(taskId);
    item.lastTask = {...item.lastTask, ...task, id: taskId || task.id};
    item.window.setTitle(this.windowTitle(item));
    if (task.state === "awaiting_verification" || task.state === "awaiting_login") {
      item.window.flashFrame?.(true);
      this.show(item, {focus: false});
    } else if (task.state === "submission_unknown") {
      item.window.flashFrame?.(false);
      if (item.window.isVisible()) item.window.hide();
    } else if (TERMINAL_TASK_STATES.has(task.state)) {
      item.window.flashFrame?.(false);
      if (!item.activeTaskIds.size && item.window.isVisible()) item.window.hide();
    }
    this.emitStatus(id, {taskState: task.state || "", taskId: taskId || null});
    return this.status(id);
  }

  finishTask(accountId, taskId, state = "completed") {
    const id = safePart(accountId);
    const item = this.sessions.get(id);
    if (!item || item.window.isDestroyed()) return null;
    item.activeTaskIds.delete(String(taskId || ""));
    item.lastTask = {...item.lastTask, id: String(taskId || ""), state};
    item.window.flashFrame?.(false);
    item.window.setTitle(this.windowTitle(item));
    if (!item.activeTaskIds.size && item.window.isVisible()) item.window.hide();
    this.emitStatus(id, {taskState: state, taskId: String(taskId || "")});
    return this.status(id);
  }

  async openPopout(item) {
    const runtime = item?.window ? item : this.sessions.get(this.accountId(item?.account || item));
    if (!runtime) throw new Error("豆包账号环境尚未打开");
    this.show(runtime, {focus: true});
    return {accountId: runtime.id, poppedOut: true, floating: true};
  }

  setPageActive(active) {
    this.pageActive = Boolean(active);
    return {ok: true, active: this.pageActive, accountId: this.activeAccountId || null, floating: true};
  }

  activateAccount(accountId) {
    const id = safePart(accountId);
    const item = this.sessions.get(id);
    if (!item || item.window.isDestroyed()) throw new Error("豆包账号环境尚未打开");
    this.show(item, {focus: true});
    return this.status(id);
  }

  hideAccount(accountId) {
    const id = safePart(accountId || this.activeAccountId);
    const item = this.sessions.get(id);
    if (!item || item.window.isDestroyed()) return {ok: true, hidden: false, accountId: id};
    item.window.hide();
    return {ok: true, hidden: true, accountId: id, activeTaskIds: [...item.activeTaskIds]};
  }

  setBounds(input = {}) {
    const n = key => Math.max(0, Math.round(Number(input[key]) || 0));
    this.requestedBounds = {x: n("x"), y: n("y"), width: n("width"), height: n("height")};
    return {ok: true, ignored: true, mode: "floating-window", bounds: this.requestedBounds};
  }

  async detect(account) {
    const item = await this.ensureLoaded(this.createSession(account));
    const cookies = await item.webContents.session.cookies.get({url: this.platformUrl(item.account)});
    let page = {onPlatform: isDoubaoUrl(item.webContents.getURL()), readyState: item.webContents.isLoading() ? "loading" : "complete", bodyTextLength: 0};
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        page = await item.webContents.executeJavaScript(DOUBAO_LOGIN_PROBE_EXPRESSION, true);
      } catch (error) {
        page = {...page, probeError: String(error?.message || error || "豆包登录检测脚本执行失败")};
      }
      const pageStable = page.readyState === "complete" && Number(page.bodyTextLength || 0) > 20;
      if (hasDecisivePageLoginSignal(page) || (pageStable && attempt >= 4)) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    const detected = classifyDoubaoLoginState({...page, url: item.webContents.getURL()}, cookies);
    item.lastLoginState = detected;
    this.emitStatus(item.id, {loginState: detected.state, loggedIn: detected.loggedIn, verificationRequired: detected.verificationRequired, platformAccountName: detected.platformAccountName || ""});
    return {...detected, accountId: item.id, partition: item.partition, url: item.webContents.getURL(), floating: true};
  }

  discoverLocalAccounts() {
    if (!this.localAccountImport) return [];
    return this.localAccountImport.discover();
  }

  importLocalAccount(candidateRef) {
    if (!this.localAccountImport) throw new Error("本机豆包账号加载服务未就绪");
    return this.localAccountImport.importCandidate(candidateRef);
  }

  close(account, options = {}) {
    const id = this.accountId(account);
    const item = this.sessions.get(id);
    if (!item || item.window.isDestroyed()) return {ok: true, closed: false, accountId: id};
    if (item.activeTaskIds.size && !options.force) {
      item.window.hide();
      return {ok: true, closed: false, hidden: true, protected: true, accountId: id, activeTaskIds: [...item.activeTaskIds]};
    }
    item.window.destroy();
    return {ok: true, closed: true, accountId: id};
  }

  status(accountId = "") {
    const item = accountId ? this.sessions.get(safePart(accountId)) : null;
    const describe = runtime => ({
      accountId: runtime.id,
      partition: runtime.partition,
      url: runtime.webContents.getURL(),
      loading: runtime.webContents.isLoading(),
      visible: runtime.window.isVisible(),
      minimized: runtime.window.isMinimized(),
      bounds: runtime.window.getBounds(),
      activeTaskIds: [...runtime.activeTaskIds],
      closeProtected: runtime.closeProtected,
      loginState: runtime.lastLoginState?.state || "unchecked",
      loggedIn: runtime.lastLoginState?.loggedIn === true,
      verificationRequired: runtime.lastLoginState?.verificationRequired === true,
      platformAccountName: runtime.lastLoginState?.platformAccountName || "",
    });
    return {
      ok: true,
      floating: true,
      pageActive: this.pageActive,
      activeAccountId: this.activeAccountId || null,
      current: item && !item.window.isDestroyed() ? describe(item) : null,
      accounts: [...this.sessions.values()].filter(runtime => !runtime.window.isDestroyed()).map(describe),
    };
  }

  dispose() {
    this.disposing = true;
    for (const item of this.sessions.values()) {
      try { item.window.destroy(); } catch {}
    }
    this.sessions.clear();
    this.activeAccountId = "";
  }
  resetTenant() {
    this.disposing = true;
    for (const item of this.sessions.values()) {
      try { item.window.destroy(); } catch {}
    }
    this.sessions.clear();
    this.activeAccountId = "";
    this.disposing = false;
    return {ok: true};
  }
}

module.exports = {EmbeddedBrowserManager, SAFE_WINDOW};
