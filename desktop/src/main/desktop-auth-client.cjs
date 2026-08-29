"use strict";

const {EventEmitter} = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {deviceFingerprint} = require("./license-client.cjs");

const AUTH_PATH = "/api/v1/auth";
const DESKTOP_BOOTSTRAP_PATH = "/api/v1/desktop/bootstrap";
const PLATFORM_MODEL_CAPABILITIES = new Set(["text", "image", "video", "audio"]);
const FORBIDDEN_PLATFORM_MODEL_KEYS = new Set([
  "apikey", "authorization", "baseurl", "constructor", "credential", "credentialref",
  "customheaders", "databaseurl", "headers", "privateheaders", "proto", "prototype",
  "secret", "token",
]);
const MAX_PLATFORM_MODELS = 500;
const MAX_BOOTSTRAP_SKILLS = 100;
const MAX_BOOTSTRAP_ACCOUNTS = 50;
const MAX_RECENT_PROJECTS = 10;
const REFRESH_EARLY_MS = 120_000;
const MIN_REFRESH_DELAY_MS = 5_000;
const MAX_CONTRACT_DEPTH = 12;
const MAX_CONTRACT_ARRAY_ITEMS = 1000;
const MAX_CONTRACT_OBJECT_KEYS = 200;

function cleanBaseUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return ""; }
}

function uniqueUrls(values) {
  return [...new Set((Array.isArray(values) ? values : [values])
    .map(cleanBaseUrl)
    .filter(Boolean))];
}

function parseTime(value) {
  const result = Date.parse(String(value || ""));
  return Number.isFinite(result) ? result : 0;
}

function canUseOfflineBootstrap(error) {
  const status = Number(error?.status || 0);
  return status >= 500 || ["AUTH_SERVICE_TIMEOUT", "AUTH_SERVICE_UNAVAILABLE"].includes(error?.code);
}

function contractError() {
  const error = new Error("身份服务返回的工作台初始化数据不完整");
  error.code = "INVALID_DESKTOP_BOOTSTRAP_RESPONSE";
  return error;
}

function contractText(value) {
  return String(value || "").trim();
}

function contractKey(value) {
  return String(value || "").replace(/[^A-Za-z0-9]/g, "").toLowerCase();
}

function publicContractValue(value, depth = 0) {
  if (depth > MAX_CONTRACT_DEPTH) throw contractError();
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw contractError();
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_CONTRACT_ARRAY_ITEMS) throw contractError();
    return value.map((item) => publicContractValue(item, depth + 1));
  }
  if (!value || typeof value !== "object") throw contractError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw contractError();
  const entries = Object.entries(value);
  if (entries.length > MAX_CONTRACT_OBJECT_KEYS) throw contractError();
  const copy = {};
  for (const [key, item] of entries) {
    if (!key || FORBIDDEN_PLATFORM_MODEL_KEYS.has(contractKey(key))) throw contractError();
    copy[key] = publicContractValue(item, depth + 1);
  }
  return copy;
}

function publicContractObject(value) {
  const normalized = publicContractValue(value);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== "object") throw contractError();
  return normalized;
}

function normalizePlatformModel(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError();
  for (const key of Object.keys(value)) {
    if (FORBIDDEN_PLATFORM_MODEL_KEYS.has(contractKey(key))) throw contractError();
  }
  const id = contractText(value.id);
  const source = contractText(value.source);
  const code = contractText(value.code);
  const displayName = contractText(value.displayName);
  const capabilityType = contractText(value.capabilityType);
  const catalogVersion = Number(value.catalogVersion);
  const providerId = contractText(value.provider?.id);
  const providerCode = contractText(value.provider?.code);
  const providerDisplayName = contractText(value.provider?.displayName);
  if (!id || source !== "platform" || !code || !displayName
    || !PLATFORM_MODEL_CAPABILITIES.has(capabilityType)
    || !Number.isSafeInteger(catalogVersion) || catalogVersion < 1
    || !providerId || !providerCode || !providerDisplayName
    || typeof value.executionReady !== "boolean") {
    throw contractError();
  }
  return {
    id,
    source,
    provider: {id: providerId, code: providerCode, displayName: providerDisplayName},
    code,
    displayName,
    capabilityType,
    parameterSchema: publicContractObject(value.parameterSchema),
    defaultParameters: publicContractObject(value.defaultParameters),
    catalogVersion,
    executionReady: value.executionReady === true,
  };
}

function normalizeModelCatalog(value, models) {
  if (value === undefined || value === null) {
    if (models.length) throw contractError();
    return {available: false, version: null, publishedAt: null};
  }
  if (typeof value !== "object" || Array.isArray(value)) throw contractError();
  const available = value.available === true;
  const version = value.version === null || value.version === undefined ? null : Number(value.version);
  const publishedAt = value.publishedAt === null || value.publishedAt === undefined
    ? null
    : String(value.publishedAt);
  if (available) {
    if (!Number.isSafeInteger(version) || version < 1 || !publishedAt || !parseTime(publishedAt)) {
      throw contractError();
    }
  } else if (version !== null || publishedAt !== null || models.length) {
    throw contractError();
  }
  if (models.some((model) => model.catalogVersion !== version)) throw contractError();
  return {available, version, publishedAt};
}

class DesktopAuthClient extends EventEmitter {
  constructor({
    dataRoot,
    appVersion,
    safeStorage,
    serverUrlsProvider = null,
    serverUrl = process.env.LINGFRAME_IDENTITY_SERVER_URL || "http://127.0.0.1:9001",
    fetchFn = globalThis.fetch,
    now = () => Date.now(),
    device = null,
  }) {
    super();
    this.dataRoot = dataRoot;
    this.appVersion = String(appVersion || "0.0.0");
    this.safeStorage = safeStorage;
    this.serverUrlsProvider = serverUrlsProvider;
    this.preferredServerUrl = cleanBaseUrl(serverUrl);
    this.fetchFn = fetchFn;
    this.now = now;
    this.device = device || deviceFingerprint();
    this.file = path.join(dataRoot, "desktop-user-session-v1.json");
    this.bootstrapFile = path.join(dataRoot, "desktop-bootstrap-cache-v1.json");
    this.persisted = this.readPersisted();
    this.bootstrapCache = this.readBootstrapCache();
    this.session = null;
    this.workspace = null;
    this.workspaceState = "unavailable";
    this.workspaceError = null;
    this.pendingTenantSelection = null;
    this.lastError = null;
    this.lastServerUrl = null;
    this.restoring = null;
    this.workspaceLoading = null;
    this.refreshTimer = null;
    this.refreshing = null;
  }

  readPersisted() {
    try {
      const value = JSON.parse(fs.readFileSync(this.file, "utf8"));
      return value && value.version === 1 ? value : {};
    } catch { return {}; }
  }

  readBootstrapCache() {
    try {
      const value = JSON.parse(fs.readFileSync(this.bootstrapFile, "utf8"));
      if (value && value.version === 1) return value;
    } catch {}
    try { fs.rmSync(this.bootstrapFile, {force: true}); } catch {}
    return {};
  }

  clearBootstrapCache() {
    this.bootstrapCache = {};
    this.workspace = null;
    this.workspaceState = "unavailable";
    this.workspaceError = null;
    try { fs.rmSync(this.bootstrapFile, {force: true}); } catch {}
  }

  encrypt(value) {
    const text = String(value || "");
    if (!text) return "";
    if (!this.safeStorage?.isEncryptionAvailable?.()) {
      const error = new Error("系统安全存储暂不可用，无法保存登录会话");
      error.code = "SECURE_STORAGE_UNAVAILABLE";
      throw error;
    }
    return this.safeStorage.encryptString(text).toString("base64");
  }

  decrypt(value) {
    try {
      if (!value || !this.safeStorage?.isEncryptionAvailable?.()) return "";
      return this.safeStorage.decryptString(Buffer.from(String(value), "base64"));
    } catch { return ""; }
  }

  saveSession(response, {preserveWorkspace = false} = {}) {
    const previousUserId = this.session?.user?.id || this.persisted?.user?.id || null;
    const previousTenantId = this.session?.tenant?.id || this.persisted?.tenant?.id || null;
    if ((previousUserId && String(previousUserId) !== String(response.user?.id || ""))
      || (previousTenantId && String(previousTenantId) !== String(response.tenant?.id || ""))) {
      this.clearBootstrapCache();
    }
    const next = {
      version: 1,
      accessToken: this.encrypt(response.accessToken),
      refreshToken: this.encrypt(response.refreshToken),
      accessTokenExpiresAt: response.accessTokenExpiresAt,
      refreshTokenExpiresAt: response.refreshTokenExpiresAt,
      session: response.session,
      user: response.user,
      tenant: response.tenant,
      role: response.role,
      permissions: Array.isArray(response.permissions) ? response.permissions : [],
      featurePolicies: response.featurePolicies || {},
      savedAt: new Date(this.now()).toISOString(),
    };
    fs.mkdirSync(this.dataRoot, {recursive: true});
    const temp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(temp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
    this.persisted = next;
    this.session = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      accessTokenExpiresAt: response.accessTokenExpiresAt,
      refreshTokenExpiresAt: response.refreshTokenExpiresAt,
      session: response.session,
      user: response.user,
      tenant: response.tenant,
      role: response.role,
      permissions: next.permissions,
      featurePolicies: next.featurePolicies,
    };
    this.pendingTenantSelection = null;
    this.lastError = null;
    if (!preserveWorkspace) {
      this.workspace = null;
      this.workspaceState = "loading";
      this.workspaceError = null;
    }
    this.scheduleRefresh();
    this.emitChange();
    return this.status();
  }

  clearLocal() {
    this.clearRefreshTimer();
    this.persisted = {};
    this.session = null;
    this.pendingTenantSelection = null;
    this.lastError = null;
    try { fs.rmSync(this.file, {force: true}); } catch {}
    this.clearBootstrapCache();
    this.emitChange();
    return this.status();
  }

  beginTenantSelection(response) {
    this.clearRefreshTimer();
    this.persisted = {};
    this.session = null;
    this.lastError = null;
    try { fs.rmSync(this.file, {force: true}); } catch {}
    this.clearBootstrapCache();
    this.pendingTenantSelection = {
      ticket: response.tenantSelectionTicket,
      expiresAt: response.expiresAt,
      tenants: Array.isArray(response.tenants) ? response.tenants : [],
    };
    this.emitChange();
    return this.status();
  }

  serverUrls() {
    const configured = typeof this.serverUrlsProvider === "function"
      ? this.serverUrlsProvider()
      : [];
    return uniqueUrls([
      this.preferredServerUrl,
      ...(Array.isArray(configured) ? configured : []),
    ]);
  }

  deviceRequest() {
    return {
      deviceHash: this.device.hash,
      fingerprintVersion: this.device.version,
      displayName: os.hostname().slice(0, 160),
      platform: process.platform.slice(0, 32),
      architecture: process.arch.slice(0, 32),
      appVersion: this.appVersion.slice(0, 32),
    };
  }

  async request(pathname, {method = "POST", body, token, headers = {}, timeoutMs = 10000} = {}) {
    let lastError = null;
    for (const baseUrl of this.serverUrls()) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const response = await this.fetchFn(`${baseUrl}${pathname}`, {
          method,
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "User-Agent": `LingFrameAI-Desktop/${this.appVersion}`,
            ...(token ? {Authorization: `Bearer ${token}`} : {}),
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
        const data = response.status === 204 ? {} : await response.json().catch(() => ({}));
        if (!response.ok) {
          const error = new Error(data.message || data.error || `身份服务返回 ${response.status}`);
          error.code = data.code || "AUTH_REQUEST_REJECTED";
          error.status = response.status;
          error.fieldErrors = data.fieldErrors || {};
          throw error;
        }
        this.lastServerUrl = baseUrl;
        this.lastError = null;
        return data;
      } catch (error) {
        lastError = error;
        if (Number(error?.status || 0) > 0 && Number(error.status) < 500) throw error;
      } finally { clearTimeout(timer); }
    }
    const error = lastError || new Error("身份服务暂时不可用，请检查网络后重试");
    if (error.name === "AbortError") {
      error.message = "连接身份服务超时，请检查网络后重试";
      error.code = "AUTH_SERVICE_TIMEOUT";
    } else if (!Number(error?.status || 0)) {
      error.message = "身份服务暂时不可用，请检查网络后重试";
      error.code = "AUTH_SERVICE_UNAVAILABLE";
    }
    this.lastError = {code: error.code, message: error.message, at: new Date(this.now()).toISOString()};
    throw error;
  }

  validateAuthenticated(response) {
    if (response?.status !== "authenticated" || !response.accessToken || !response.refreshToken || !response.tenant?.id || !response.user?.id) {
      const error = new Error("身份服务返回的登录会话不完整");
      error.code = "INVALID_AUTH_RESPONSE";
      throw error;
    }
    return response;
  }

  validateDesktopBootstrap(response, current) {
    const doubaoAccounts = response?.doubaoAccounts === undefined ? [] : response.doubaoAccounts;
    const recentProjects = response?.recentProjects === undefined ? [] : response.recentProjects;
    const valid = response?.schemaVersion === 1
      && String(response?.user?.id || "") === String(current?.user?.id || "")
      && String(response?.tenant?.id || "") === String(current?.tenant?.id || "")
      && String(response?.membership?.id || "") === String(current?.session?.membershipId || "")
      && Array.isArray(response?.permissions)
      && response.permissions.includes("desktop.bootstrap")
      && Array.isArray(response?.models)
      && response.models.length <= MAX_PLATFORM_MODELS
      && Array.isArray(response?.skills)
      && response.skills.length <= MAX_BOOTSTRAP_SKILLS
      && Array.isArray(doubaoAccounts)
      && doubaoAccounts.length <= MAX_BOOTSTRAP_ACCOUNTS
      && Array.isArray(recentProjects)
      && recentProjects.length <= MAX_RECENT_PROJECTS;
    if (!valid) {
      throw contractError();
    }
    const models = response.models.map(normalizePlatformModel);
    const modelCatalog = normalizeModelCatalog(response.modelCatalog, models);
    const skills = publicContractValue(response.skills);
    if (!Array.isArray(skills)) throw contractError();
    const normalizedAccounts = doubaoAccounts.map((item) => {
      const accountId = contractText(item?.accountId);
      const displayName = contractText(item?.displayName);
      const loginState = contractText(item?.loginState);
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(accountId) || !displayName
        || !["unknown", "logged_in", "logged_out", "verification_required"].includes(loginState)) {
        throw contractError();
      }
      return {
        accountId,
        displayName,
        loginState,
        loginSummary: contractText(item?.loginSummary).slice(0, 300),
        lastCheckedAt: item?.lastCheckedAt || null,
        updatedAt: item?.updatedAt || null,
      };
    });
    const normalizedProjects = recentProjects.map((item) => {
      const id = contractText(item?.id);
      const name = contractText(item?.name);
      if (!id || !name) throw contractError();
      return {id, name, updatedAt: item?.updatedAt || null};
    });
    const balance = Number(response?.credits?.balance || 0);
    if (!Number.isSafeInteger(balance) || balance < 0) throw contractError();
    return {
      schemaVersion: 1,
      generatedAt: response.generatedAt || new Date(this.now()).toISOString(),
      user: {
        id: response.user.id,
        username: response.user.username || "",
        email: response.user.email || "",
      },
      tenant: {
        id: response.tenant.id,
        code: response.tenant.code || "",
        displayName: response.tenant.displayName || "",
      },
      membership: {
        id: response.membership.id,
        role: response.membership.role || "",
      },
      permissions: [...response.permissions],
      features: {infiniteCanvas: Boolean(response?.features?.infiniteCanvas)},
      credits: {
        available: Boolean(response?.credits?.available),
        balance,
      },
      modelCatalog,
      models,
      skills,
      doubaoAccounts: normalizedAccounts,
      recentProjects: normalizedProjects,
    };
  }

  saveDesktopBootstrap(response) {
    const current = this.session || this.hydratedSession();
    const data = this.validateDesktopBootstrap(response, current);
    const next = {
      version: 1,
      userId: current.user.id,
      tenantId: current.tenant.id,
      data,
      savedAt: new Date(this.now()).toISOString(),
    };
    fs.mkdirSync(this.dataRoot, {recursive: true});
    const temp = `${this.bootstrapFile}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(temp, this.bootstrapFile);
    try { fs.chmodSync(this.bootstrapFile, 0o600); } catch {}
    this.bootstrapCache = next;
    this.workspace = data;
    this.workspaceState = "ready";
    this.workspaceError = null;
    this.lastError = null;
    this.emitChange();
    return this.status();
  }

  useCachedBootstrap(error) {
    const current = this.session || this.hydratedSession();
    const cache = this.bootstrapCache || this.readBootstrapCache();
    const matches = current?.user?.id
      && current?.tenant?.id
      && String(cache?.userId || "") === String(current.user.id)
      && String(cache?.tenantId || "") === String(current.tenant.id);
    if (!matches) return false;
    try {
      this.workspace = this.validateDesktopBootstrap(cache.data, current);
    } catch {
      this.clearBootstrapCache();
      return false;
    }
    this.workspaceState = "offline_cache";
    this.workspaceError = {
      code: error?.code || "AUTH_SERVICE_UNAVAILABLE",
      message: error?.message || "身份服务暂时不可用，已进入离线工作台",
      at: new Date(this.now()).toISOString(),
    };
    this.lastError = this.workspaceError;
    this.emitChange();
    return true;
  }

  async loadDesktopBootstrap() {
    if (this.workspaceLoading) return this.workspaceLoading;
    this.workspaceLoading = this.loadDesktopBootstrapOnce()
      .finally(() => { this.workspaceLoading = null; });
    return this.workspaceLoading;
  }

  async loadDesktopBootstrapOnce() {
    let current = this.session || this.hydratedSession();
    if (!current?.refreshToken || parseTime(current.refreshTokenExpiresAt) <= this.now()) {
      if (current) this.clearLocal();
      return this.status();
    }
    this.session = current;
    this.workspaceState = "loading";
    this.workspaceError = null;
    this.emitChange();
    try {
      if (!current.accessToken || parseTime(current.accessTokenExpiresAt) <= this.now() + 60_000) {
        await this.refresh({loadWorkspace: false});
        current = this.session;
      }
      let response;
      try {
        response = await this.request(DESKTOP_BOOTSTRAP_PATH, {
          method: "GET",
          token: current.accessToken,
        });
      } catch (error) {
        if (Number(error?.status || 0) !== 401) throw error;
        await this.refresh({loadWorkspace: false});
        current = this.session;
        response = await this.request(DESKTOP_BOOTSTRAP_PATH, {
          method: "GET",
          token: current.accessToken,
        });
      }
      return this.saveDesktopBootstrap(response);
    } catch (error) {
      if (!this.session) return this.status();
      const status = Number(error?.status || 0);
      if (status === 403) {
        this.clearBootstrapCache();
        this.workspaceState = "forbidden";
        this.workspaceError = {
          code: error.code || "DESKTOP_BOOTSTRAP_FORBIDDEN",
          message: error.message || "当前账号没有加载桌面工作台的权限",
          at: new Date(this.now()).toISOString(),
        };
        this.emitChange();
        return this.status();
      }
      if (error?.code === "INVALID_DESKTOP_BOOTSTRAP_RESPONSE") this.clearBootstrapCache();
      if (canUseOfflineBootstrap(error) && this.useCachedBootstrap(error)) return this.status();
      this.workspace = null;
      this.workspaceState = "unavailable";
      this.workspaceError = {
        code: error?.code || "DESKTOP_BOOTSTRAP_UNAVAILABLE",
        message: error?.message || "工作台初始化失败，请重试",
        at: new Date(this.now()).toISOString(),
      };
      this.emitChange();
      return this.status();
    }
  }

  async login(input = {}) {
    const response = await this.request(`${AUTH_PATH}/login`, {
      body: {
        identity: String(input.identity || "").trim(),
        password: String(input.password || ""),
        clientType: "desktop",
        device: this.deviceRequest(),
      },
    });
    if (response?.status === "tenant_selection_required") {
      return this.beginTenantSelection(response);
    }
    this.saveSession(this.validateAuthenticated(response));
    return this.loadDesktopBootstrap();
  }

  async register(input = {}) {
    const response = await this.request(`${AUTH_PATH}/register`, {
      body: {
        username: String(input.username || "").trim(),
        email: String(input.email || "").trim(),
        password: String(input.password || ""),
        invitationToken: String(input.invitationToken || "").trim() || null,
        clientType: "desktop",
        device: this.deviceRequest(),
      },
    });
    this.saveSession(this.validateAuthenticated(response));
    return this.loadDesktopBootstrap();
  }

  async selectTenant(tenantId) {
    if (!this.pendingTenantSelection?.ticket) {
      const error = new Error("租户选择已失效，请重新登录");
      error.code = "TENANT_SELECTION_REQUIRED";
      throw error;
    }
    const response = await this.request(`${AUTH_PATH}/select-tenant`, {
      body: {
        tenantSelectionTicket: this.pendingTenantSelection.ticket,
        tenantId: String(tenantId || ""),
        device: this.deviceRequest(),
      },
    });
    this.saveSession(this.validateAuthenticated(response));
    return this.loadDesktopBootstrap();
  }

  hydratedSession() {
    if (!this.persisted?.tenant?.id || !this.persisted?.user?.id) return null;
    const accessToken = this.decrypt(this.persisted.accessToken);
    const refreshToken = this.decrypt(this.persisted.refreshToken);
    if (!refreshToken) return null;
    return {
      accessToken,
      refreshToken,
      accessTokenExpiresAt: this.persisted.accessTokenExpiresAt,
      refreshTokenExpiresAt: this.persisted.refreshTokenExpiresAt,
      session: this.persisted.session,
      user: this.persisted.user,
      tenant: this.persisted.tenant,
      role: this.persisted.role,
      permissions: this.persisted.permissions || [],
      featurePolicies: this.persisted.featurePolicies || {},
    };
  }

  async refresh({loadWorkspace = true} = {}) {
    if (this.refreshing) {
      const status = await this.refreshing;
      return loadWorkspace ? this.loadDesktopBootstrap() : status;
    }
    this.refreshing = this.refreshOnce({loadWorkspace: false})
      .finally(() => { this.refreshing = null; });
    const status = await this.refreshing;
    return loadWorkspace ? this.loadDesktopBootstrap() : status;
  }

  async refreshOnce({loadWorkspace = false} = {}) {
    const current = this.session || this.hydratedSession();
    if (!current?.refreshToken) {
      const error = new Error("登录会话不存在，请重新登录");
      error.code = "AUTHENTICATION_REQUIRED";
      throw error;
    }
    try {
      const response = await this.request(`${AUTH_PATH}/refresh`, {
        body: {refreshToken: current.refreshToken},
      });
      this.saveSession(this.validateAuthenticated(response), {preserveWorkspace: !loadWorkspace});
      return loadWorkspace ? this.loadDesktopBootstrap() : this.status();
    } catch (error) {
      if ([400, 401, 403].includes(Number(error?.status || 0))) this.clearLocal();
      throw error;
    }
  }

  async me() {
    const current = this.session || this.hydratedSession();
    if (!current?.accessToken) return this.refresh({loadWorkspace: false});
    if (parseTime(current.accessTokenExpiresAt) <= this.now() + 60_000) {
      return this.refresh({loadWorkspace: false});
    }
    try {
      const me = await this.request(`${AUTH_PATH}/me`, {method: "GET", token: current.accessToken});
      return this.saveSession(this.validateAuthenticated({
        status: "authenticated",
        accessToken: current.accessToken,
        refreshToken: current.refreshToken,
        accessTokenExpiresAt: current.accessTokenExpiresAt,
        refreshTokenExpiresAt: current.refreshTokenExpiresAt,
        session: current.session,
        user: {id: me.userId, username: me.username, email: me.email},
        tenant: {id: me.tenantId, code: me.tenantCode, displayName: me.tenantName},
        role: me.role,
        permissions: Array.isArray(me.permissions) ? me.permissions : [],
        featurePolicies: me.featurePolicies || {},
      }), {preserveWorkspace: true});
    } catch (error) {
      if (Number(error?.status || 0) === 401) return this.refresh({loadWorkspace: false});
      throw error;
    }
  }

  async bootstrap() {
    if (this.restoring) return this.restoring;
    this.restoring = (async () => {
      const hydrated = this.hydratedSession();
      if (!hydrated) return this.status();
      if (parseTime(hydrated.refreshTokenExpiresAt) <= this.now()) {
        return this.clearLocal();
      }
      this.session = hydrated;
      this.scheduleRefresh();
      this.workspaceState = "loading";
      this.workspaceError = null;
      try {
        if (parseTime(hydrated.accessTokenExpiresAt) > this.now() + 60_000) await this.me();
        else await this.refresh({loadWorkspace: false});
      } catch (error) {
        const status = Number(error?.status || 0);
        if (status > 0 && status < 500) return this.clearLocal();
        this.lastError = {code: error.code || "AUTH_SERVICE_UNAVAILABLE", message: error.message, at: new Date(this.now()).toISOString()};
        if (error?.code === "INVALID_AUTH_RESPONSE") this.clearBootstrapCache();
        if (canUseOfflineBootstrap(error) && this.useCachedBootstrap(error)) return this.status();
        this.workspaceState = "unavailable";
        this.workspaceError = this.lastError;
        this.emitChange();
        return this.status();
      }
      return this.loadDesktopBootstrap();
    })().finally(() => { this.restoring = null; });
    return this.restoring;
  }

  async logout() {
    const current = this.session || this.hydratedSession();
    if (current?.accessToken) {
      try { await this.request(`${AUTH_PATH}/logout`, {token: current.accessToken}); } catch {}
    }
    return this.clearLocal();
  }

  status() {
    const tenant = this.session?.tenant || null;
    const user = this.session?.user || null;
    const authenticated = Boolean(
      tenant?.id
      && user?.id
      && this.session?.refreshToken
      && parseTime(this.session.refreshTokenExpiresAt) > this.now()
    );
    const workspaceReady = Boolean(
      authenticated
      && this.workspace
      && ["ready", "offline_cache"].includes(this.workspaceState)
    );
    const usable = workspaceReady;
    let state = "unauthenticated";
    if (this.pendingTenantSelection) state = "tenant_selection_required";
    else if (authenticated && workspaceReady) {
      state = this.workspaceState === "offline_cache" ? "authenticated_offline" : "authenticated";
    } else if (authenticated && this.workspaceState === "loading") state = "workspace_initializing";
    else if (authenticated && this.workspaceState === "forbidden") state = "workspace_forbidden";
    else if (authenticated) state = "workspace_unavailable";
    return {
      usable,
      authenticated,
      workspaceReady,
      state,
      source: authenticated ? "user-session" : null,
      tenantId: workspaceReady ? (tenant?.id || null) : null,
      tenant,
      user,
      role: this.session?.role || null,
      permissions: this.session?.permissions || [],
      featurePolicies: this.session?.featurePolicies || {},
      accessTokenExpiresAt: this.session?.accessTokenExpiresAt || null,
      refreshTokenExpiresAt: this.session?.refreshTokenExpiresAt || null,
      offline: Boolean(workspaceReady && this.workspaceState === "offline_cache"),
      reason: workspaceReady
        ? null
        : (authenticated
          ? (this.workspaceError?.message || "正在初始化工作台")
          : (this.lastError?.message || "请登录灵帧AI账号")),
      lastError: this.lastError,
      bootstrap: {
        state: this.workspaceState,
        data: this.workspace,
        error: this.workspaceError,
        cachedAt: this.bootstrapCache?.savedAt || null,
      },
      tenantSelection: this.pendingTenantSelection ? {
        expiresAt: this.pendingTenantSelection.expiresAt,
        tenants: this.pendingTenantSelection.tenants,
      } : null,
      deviceSuffix: this.device.suffix,
    };
  }

  tenantId() { return this.status().tenantId; }
  userId() { return this.status().workspaceReady ? (this.session?.user?.id || null) : null; }
  runtimeTenantId() {
    const status = this.status();
    return status.authenticated && (status.workspaceReady || status.bootstrap?.state === "loading")
      ? (this.session?.tenant?.id || null)
      : null;
  }
  runtimeUserId() {
    const status = this.status();
    return status.authenticated && (status.workspaceReady || status.bootstrap?.state === "loading")
      ? (this.session?.user?.id || null)
      : null;
  }
  clearRefreshTimer() {
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
  }
  scheduleRefresh() {
    this.clearRefreshTimer();
    const expiresAt = parseTime(this.session?.accessTokenExpiresAt);
    if (!expiresAt || !this.session?.refreshToken) return;
    const delay = Math.max(MIN_REFRESH_DELAY_MS, expiresAt - this.now() - REFRESH_EARLY_MS);
    this.refreshTimer = setTimeout(() => {
      this.refresh({loadWorkspace: false})
        .then(() => this.loadDesktopBootstrap())
        .catch(() => {});
    }, delay);
    this.refreshTimer.unref?.();
  }
  async authenticatedRequest(pathname, options = {}) {
    let current = this.session || this.hydratedSession();
    if (!current?.refreshToken) {
      const error = new Error("登录会话不存在，请重新登录");
      error.code = "AUTHENTICATION_REQUIRED";
      throw error;
    }
    if (!current.accessToken || parseTime(current.accessTokenExpiresAt) <= this.now() + 60_000) {
      await this.refresh({loadWorkspace: false});
      current = this.session;
    }
    try {
      return await this.request(pathname, {...options, token: current.accessToken});
    } catch (error) {
      if (Number(error?.status || 0) !== 401) throw error;
      await this.refresh({loadWorkspace: false});
      return this.request(pathname, {...options, token: this.session.accessToken});
    }
  }
  async authenticatedUpload(pathname, filePath, {contentType = "application/octet-stream", filename = "upload.bin"} = {}) {
    const fsModule = require("fs");
    const bytes = fsModule.readFileSync(filePath);
    let current = this.session || this.hydratedSession();
    if (!current?.refreshToken) { const error = new Error("登录会话不存在，请重新登录"); error.code = "AUTHENTICATION_REQUIRED"; throw error; }
    if (!current.accessToken || parseTime(current.accessTokenExpiresAt) <= this.now() + 60_000) { await this.refresh({loadWorkspace: false}); current = this.session; }
    const perform = async token => {
      const form = new FormData();
      form.append("file", new Blob([bytes], {type: contentType}), filename);
      const baseUrls = this.serverUrls();
      let lastError = null;
      for (const baseUrl of baseUrls) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 120000);
        try {
          const response = await this.fetchFn(`${baseUrl}${pathname}`, {method: "POST", headers: {Authorization: `Bearer ${token}`, "User-Agent": `LingFrameAI-Desktop/${this.appVersion}`}, body: form, signal: controller.signal});
          const data = await response.json().catch(() => ({}));
          if (!response.ok) { const error = new Error(data.message || data.error || `身份服务返回 ${response.status}`); error.status = response.status; error.code = data.code || "AUTH_REQUEST_REJECTED"; throw error; }
          this.lastServerUrl = baseUrl; return data;
        } catch (error) { lastError = error; if (Number(error?.status || 0) > 0 && Number(error.status) < 500) throw error; }
        finally { clearTimeout(timer); }
      }
      throw lastError || new Error("素材上传服务暂时不可用，请稍后重试");
    };
    try { return await perform(current.accessToken); }
    catch (error) { if (Number(error?.status || 0) !== 401) throw error; await this.refresh({loadWorkspace: false}); return perform(this.session.accessToken); }
  }
  agentConfig() { return null; }
  credentials() { return {}; }
  assert(capability = "write-local") {
    const status = this.status();
    if (!status.usable) {
      const error = new Error("登录会话已失效，请重新登录");
      error.code = "AUTHENTICATION_REQUIRED";
      error.capability = capability;
      throw error;
    }
    const required = {
      "read-local": ["project.use", "asset.use", "task.use"],
      "write-local": ["project.use", "asset.use", "task.use"],
      generate: ["creation.use"],
      "account-control": ["doubao_account.use"],
      "agent-control": ["doubao_account.use"],
      "credits-read": ["credits.self.read"],
      "credits-recharge": ["credits.self.recharge"],
    }[capability] || [];
    if (required.length && !required.some((permission) => status.permissions.includes(permission))) {
      const error = new Error("当前账号没有执行此操作的权限");
      error.code = "DESKTOP_PERMISSION_FORBIDDEN";
      error.capability = capability;
      error.requiredPermissions = required;
      throw error;
    }
    return status;
  }
  emitChange() { this.emit("change", this.status()); }
}

module.exports = {DesktopAuthClient, cleanBaseUrl, uniqueUrls};
