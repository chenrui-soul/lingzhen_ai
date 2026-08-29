"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {PUBLIC_KEY, APP_ID} = require("./license-client.cjs");

const CONFIG_PATH = "/api/v1/client-config";
const ADMIN_VERIFY_PATH = "/api/v1/client-admin/verify";

function cleanBaseUrl(value, options = {}) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["http:", "https:"].includes(url.protocol)) return "";
    if (url.username || url.password || url.search || url.hash) return "";
    const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
    if (url.protocol !== "https:" && !local && options.allowPublicHttp !== true) return "";
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
  } catch { return ""; }
}

function uniqueUrls(values, options = {}) {
  return [...new Set((Array.isArray(values) ? values : [values]).map(value => cleanBaseUrl(value, options)).filter(Boolean))].slice(0, 8);
}

function configEndpoint(baseUrl) {
  return new URL(CONFIG_PATH.replace(/^\//, ""), `${String(baseUrl).replace(/\/+$/, "")}/`).toString();
}

function publicError() { return "服务暂时不可用，请检查网络后重试"; }

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs || 6000));
  try {
    const response = await fetch(url, {
      method: options.method || "GET",
      headers: {"Content-Type": "application/json", "User-Agent": `LingFrameAI-Desktop/${options.appVersion || "0.12.1"}`},
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || `HTTP ${response.status}`);
      error.status = response.status;
      error.code = data.code || "REMOTE_CONFIG_REJECTED";
      throw error;
    }
    return data;
  } finally { clearTimeout(timer); }
}

class ConnectionConfig {
  constructor({dataRoot, bootstrapFile, publicKey = PUBLIC_KEY, appId = APP_ID, appVersion = "0.12.1", requestFn = fetchJson, now = () => Date.now(), allowPublicHttp = false} = {}) {
    this.dataRoot = dataRoot;
    this.bootstrapFile = bootstrapFile;
    this.publicKey = publicKey;
    this.appId = appId;
    this.appVersion = appVersion;
    this.requestFn = requestFn;
    this.now = now;
    this.cacheFile = path.join(dataRoot, "connection-config-cache.json");
    this.overrideFile = path.join(dataRoot, "connection-admin-override.json");
    this.cache = this.readJson(this.cacheFile) || {};
    this.override = this.readJson(this.overrideFile) || {mode: "auto"};
    this.lastSyncAt = this.cache.savedAt || null;
    this.lastSuccessAt = null;
    this.lastError = null;
    this.activeBaseUrl = "";
    this.adminSessions = new Map();
    this.allowPublicHttp = allowPublicHttp === true || process.env.LINGFRAME_ALLOW_PUBLIC_HTTP === "1";
    this.bootstrap = this.readBootstrap();
    this.allowPublicHttp = this.bootstrap.allowPublicHttp === true;
  }

  readJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
  writeJson(file, value) {
    fs.mkdirSync(path.dirname(file), {recursive: true});
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(value, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(temp, file);
    try { fs.chmodSync(file, 0o600); } catch {}
  }
  readBootstrap() {
    const fromEnvironment = String(process.env.LINGFRAME_BOOTSTRAP_URLS || process.env.LINGFRAME_BOOTSTRAP_URL || "").split(/[\s,;]+/).filter(Boolean);
    const file = this.readJson(this.bootstrapFile) || {};
    const allowPublicHttp = this.allowPublicHttp === true || file.allowPublicHttp === true;
    const bootstrapUrls = uniqueUrls(fromEnvironment.length ? fromEnvironment : file.bootstrapUrls || [], {allowPublicHttp});
    return {bootstrapUrls, productionDomainRequired: file.productionDomainRequired === true, allowPublicHttp};
  }
  urlOptions() { return {allowPublicHttp: this.allowPublicHttp === true}; }
  decodeEnvelope(envelope, {allowExpired = false, scope = "client-connection-config"} = {}) {
    try {
      const bytes = Buffer.from(String(envelope?.payload || ""), "base64url");
      const signature = Buffer.from(String(envelope?.signature || ""), "base64url");
      if (!crypto.verify(null, bytes, this.publicKey, signature)) return null;
      const payload = JSON.parse(bytes.toString("utf8"));
      if (payload.version !== 1 || payload.issuer !== "dola-license-center" || payload.appId !== this.appId || payload.scope !== scope) return null;
      if (!payload.issuedAt || !payload.expiresAt) return null;
      if (!allowExpired && Date.parse(payload.expiresAt) <= this.now()) return null;
      if (scope === "client-connection-config") {
        const baseUrls = uniqueUrls(payload.baseUrls, this.urlOptions());
        if (!baseUrls.length) return null;
        return {...payload, baseUrls, licenseBaseUrls: uniqueUrls(payload.licenseBaseUrls || baseUrls, this.urlOptions()), businessBaseUrls: uniqueUrls(payload.businessBaseUrls || baseUrls, this.urlOptions()), bootstrapUrls: uniqueUrls(payload.bootstrapUrls || baseUrls, this.urlOptions())};
      }
      return payload;
    } catch { return null; }
  }
  cachedPayload() { return this.decodeEnvelope(this.cache.envelope, {allowExpired: true}); }
  bootstrapCandidates() {
    const cached = this.cachedPayload();
    return uniqueUrls([...(this.bootstrap.bootstrapUrls || []), ...(cached?.bootstrapUrls || [])], this.urlOptions());
  }
  automaticBaseUrls(kind = "unified") {
    const cached = this.cachedPayload();
    const field = kind === "license" ? "licenseBaseUrls" : (kind === "business" ? "businessBaseUrls" : "baseUrls");
    const urls = uniqueUrls(cached?.[field] || cached?.baseUrls || [], this.urlOptions());
    if (urls.length) return urls;
    return uniqueUrls(this.bootstrap.bootstrapUrls || [], this.urlOptions());
  }
  serviceUrls(kind = "unified") {
    const custom = this.override.mode === "custom" ? uniqueUrls(this.override.baseUrls || [], this.urlOptions()) : [];
    return custom.length ? custom : this.automaticBaseUrls(kind);
  }
  setActiveBaseUrl(value) { const clean = cleanBaseUrl(value, this.urlOptions()); if (clean) this.activeBaseUrl = clean; }
  async refresh() {
    const candidates = this.bootstrapCandidates();
    let lastError;
    for (const base of candidates) {
      try {
        const result = await this.requestFn(configEndpoint(base), {method: "GET", appVersion: this.appVersion, timeoutMs: 6000});
        const payload = this.decodeEnvelope(result.config);
        if (!payload) { const error = new Error("远程配置签名无效"); error.code = "INVALID_CONFIG_SIGNATURE"; throw error; }
        this.cache = {version: 1, savedAt: new Date(this.now()).toISOString(), source: cleanBaseUrl(base, this.urlOptions()), envelope: result.config};
        this.writeJson(this.cacheFile, this.cache);
        this.lastSyncAt = this.cache.savedAt;
        this.lastSuccessAt = this.cache.savedAt;
        this.lastError = null;
        this.setActiveBaseUrl(payload.baseUrls[0]);
        return this.publicStatus();
      } catch (error) { lastError = error; }
    }
    this.lastError = lastError ? publicError() : "尚未配置服务连接";
    if (this.cachedPayload() || (this.override.mode === "custom" && this.serviceUrls().length)) return this.publicStatus();
    const error = new Error(this.lastError);
    error.code = lastError?.code || "CONNECTION_CONFIG_UNAVAILABLE";
    throw error;
  }
  publicStatus() {
    const urls = this.serviceUrls("unified");
    return {
      connected: Boolean(urls.length && (this.lastSuccessAt || this.cachedPayload() || this.override.mode === "custom")),
      state: urls.length ? (this.lastError ? "cached" : "ready") : "unconfigured",
      mode: this.override.mode === "custom" ? "管理员临时线路" : "自动线路",
      endpointCount: urls.length,
      lastSyncAt: this.lastSyncAt,
      message: urls.length ? (this.lastError ? "正在使用安全缓存线路" : "服务连接正常") : "服务连接异常",
    };
  }
  adminStatus(sessionId) {
    this.assertAdminSession(sessionId);
    const cached = this.cachedPayload();
    return {
      ...this.publicStatus(),
      baseUrls: this.serviceUrls(),
      licenseBaseUrls: this.serviceUrls("license"),
      businessBaseUrls: this.serviceUrls("business"),
      automaticBaseUrls: uniqueUrls(cached?.baseUrls || [], this.urlOptions()),
      bootstrapUrls: this.bootstrapCandidates(),
      activeBaseUrl: this.activeBaseUrl,
      overrideMode: this.override.mode === "custom" ? "custom" : "auto",
      productionDomainRequired: this.bootstrap.productionDomainRequired,
      allowPublicHttp: this.allowPublicHttp,
    };
  }
  async requestWithFailover(pathname, body, options = {}) {
    const urls = this.serviceUrls(options.kind || "license");
    let lastError;
    for (const base of urls) {
      try {
        const target = new URL(String(pathname).replace(/^\//, ""), `${base}/`).toString();
        const result = await this.requestFn(target, {method: options.method || "POST", body, appVersion: this.appVersion, timeoutMs: options.timeoutMs || 8000});
        this.setActiveBaseUrl(base);
        return {result, baseUrl: base};
      } catch (error) {
        lastError = error;
        if (error?.status && error.status < 500) throw error;
      }
    }
    const error = lastError || new Error(publicError());
    if (!error.code) error.code = "ALL_ENDPOINTS_UNAVAILABLE";
    throw error;
  }
  async verifyAdmin({username, password}) {
    const {result} = await this.requestWithFailover(ADMIN_VERIFY_PATH, {username, password, appId: this.appId, appVersion: this.appVersion});
    const grant = this.decodeEnvelope(result.grant, {scope: "client-server-settings-admin"});
    if (!grant || grant.username !== String(username || "")) { const error = new Error("管理员验证失败"); error.code = "INVALID_ADMIN_GRANT"; throw error; }
    const sessionId = crypto.randomBytes(24).toString("base64url");
    this.adminSessions.set(sessionId, Math.min(Date.parse(grant.expiresAt), this.now() + 10 * 60 * 1000));
    return {ok: true, sessionId, expiresAt: new Date(this.adminSessions.get(sessionId)).toISOString()};
  }
  assertAdminSession(sessionId) {
    const expires = this.adminSessions.get(String(sessionId || ""));
    if (!expires || expires <= this.now()) { this.adminSessions.delete(String(sessionId || "")); const error = new Error("管理员会话已失效，请重新验证"); error.code = "ADMIN_SESSION_EXPIRED"; throw error; }
  }
  async applyAdminOverride(sessionId, input = {}) {
    this.assertAdminSession(sessionId);
    const mode = input.mode === "custom" ? "custom" : "auto";
    if (mode === "auto") {
      this.override = {version: 1, mode: "auto", updatedAt: new Date(this.now()).toISOString()};
      this.writeJson(this.overrideFile, this.override);
      await this.refresh().catch(() => {});
      return this.adminStatus(sessionId);
    }
    const baseUrls = uniqueUrls(input.baseUrls || [], this.urlOptions());
    if (!baseUrls.length && this.allowPublicHttp) { const error = new Error("请至少填写一个 HTTP 或 HTTPS 服务地址"); error.code = "INVALID_SERVER_URLS"; throw error; }
    if (!baseUrls.length) { const error = new Error("请至少填写一个 HTTPS 服务地址"); error.code = "INVALID_SERVER_URLS"; throw error; }
    let verified = false;
    for (const base of baseUrls) {
      try {
        const result = await this.requestFn(configEndpoint(base), {method: "GET", appVersion: this.appVersion, timeoutMs: 6000});
        if (this.decodeEnvelope(result.config, {allowExpired: false})) { verified = true; break; }
      } catch {}
    }
    if (!verified) { const error = new Error("新服务器未返回有效的灵帧AI签名配置，已拒绝切换"); error.code = "NEW_SERVER_NOT_VERIFIED"; throw error; }
    this.override = {version: 1, mode: "custom", baseUrls, updatedAt: new Date(this.now()).toISOString()};
    this.writeJson(this.overrideFile, this.override);
    this.setActiveBaseUrl(baseUrls[0]);
    return this.adminStatus(sessionId);
  }
}

module.exports = {ConnectionConfig, cleanBaseUrl, uniqueUrls, configEndpoint, fetchJson, CONFIG_PATH, ADMIN_VERIFY_PATH};
