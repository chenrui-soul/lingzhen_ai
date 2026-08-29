"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const https = require("https");

const APP_ID = "doubao-dola-workbench";
const PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAL5KE7TSE7JjCE0N0i9FHrL3kPDj36qr3IDY+s/OD+f0=
-----END PUBLIC KEY-----`;

function clean(value) { return String(value || "").replace(/[\r\n\t]/g, " ").trim().slice(0, 180); }
function machineEvidence() {
  const values = [`hostname:${clean(os.hostname())}`, `user:${clean(os.userInfo().username)}`, `platform:${process.platform}`, `arch:${process.arch}`];
  for (const list of Object.values(os.networkInterfaces())) for (const item of list || []) {
    if (!item.internal && item.mac && item.mac !== "00:00:00:00:00:00") values.push(`mac:${item.mac.toLowerCase()}`);
  }
  return [...new Set(values)].sort();
}
function deviceFingerprint() {
  const evidence = machineEvidence();
  const hash = crypto.createHash("sha256").update("dola-workbench-device-v1\0").update(evidence.join("\0")).digest("hex");
  return {version: 1, hash, suffix: hash.slice(-10), quality: evidence.length >= 2 ? "hardware" : "fallback", evidenceCount: evidence.length};
}
function iso(value) { const ms = Date.parse(String(value || "")); return Number.isFinite(ms) ? new Date(ms).toISOString() : null; }

function requestJson(serverUrl, pathname, body, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const target = new URL(pathname, `${String(serverUrl).replace(/\/+$/, "")}/`);
    const payload = Buffer.from(JSON.stringify(body || {}));
    const transport = target.protocol === "https:" ? https : http;
    const request = transport.request(target, {method: "POST", timeout: timeoutMs, headers: {"Content-Type": "application/json", "Content-Length": payload.length, "User-Agent": "LingFrameAI-Desktop/0.2.0"}}, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        let data = {};
        try { data = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch {}
        if ((response.statusCode || 500) >= 400) {
          const error = new Error(data.error || `授权中心返回 ${response.statusCode}`);
          error.code = data.code || "LICENSE_SERVER_REJECTED";
          error.status = response.statusCode;
          reject(error);
          return;
        }
        resolve(data);
      });
    });
    request.on("timeout", () => request.destroy(new Error("连接授权中心超时")));
    request.on("error", reject);
    request.end(payload);
  });
}

class LicenseClient {
  constructor({dataRoot, serverUrl = process.env.LINGFRAME_LICENSE_SERVER_URL || "http://127.0.0.1:54001", serverUrls = null, appVersion = "0.2.0", publicKey = PUBLIC_KEY, requestFn = requestJson, device = null}) {
    this.dataRoot = dataRoot;
    this.serverUrls = [...new Set((Array.isArray(serverUrls) && serverUrls.length ? serverUrls : [serverUrl]).map(value => String(value || "").trim().replace(/\/+$/, "")).filter(Boolean))];
    this.serverUrl = this.serverUrls[0] || String(serverUrl).replace(/\/+$/, "");
    this.appVersion = appVersion;
    this.appId = APP_ID;
    this.publicKey = publicKey;
    this.requestFn = requestFn;
    this.device = device || deviceFingerprint();
    this.file = path.join(dataRoot, "license-binding-v290.json");
    this.lastNetworkError = null;
    this.state = this.load();
  }
  setServerUrls(values) {
    const urls = [...new Set((Array.isArray(values) ? values : [values]).map(value => String(value || "").trim().replace(/\/+$/, "")).filter(value => /^https?:\/\//i.test(value)))];
    if (!urls.length) return this.serverUrls;
    this.serverUrls = urls;
    if (!urls.includes(this.serverUrl)) this.serverUrl = urls[0];
    return [...this.serverUrls];
  }
  async requestAny(pathname, body) {
    let lastError;
    for (const serverUrl of this.serverUrls) {
      try {
        const result = await this.requestFn(serverUrl, pathname, body);
        this.serverUrl = serverUrl;
        return result;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status < 500) throw error;
      }
    }
    throw lastError || new Error("服务连接失败");
  }
  load() { try { const state = JSON.parse(fs.readFileSync(this.file, "utf8")); return state && typeof state === "object" ? state : {}; } catch { return {}; } }
  save() {
    fs.mkdirSync(this.dataRoot, {recursive: true});
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
  }
  decodeGrant(grant) {
    try {
      const payloadBytes = Buffer.from(String(grant && grant.payload || ""), "base64url");
      const signature = Buffer.from(String(grant && grant.signature || ""), "base64url");
      if (!crypto.verify(null, payloadBytes, this.publicKey, signature)) return null;
      const payload = JSON.parse(payloadBytes.toString("utf8"));
      if (payload.version !== 1 || payload.issuer !== "dola-license-center" || payload.appId !== this.appId || payload.deviceHash !== this.device.hash) return null;
      if (!payload.tenantId || !payload.licenseId || !iso(payload.serverTime) || !iso(payload.refreshAfter) || !iso(payload.leaseExpiresAt)) return null;
      if (Date.parse(payload.refreshAfter) > Date.parse(payload.leaseExpiresAt)) return null;
      return payload;
    } catch { return null; }
  }
  status() {
    const base = {usable: false, state: "needs_activation", reason: "请输入平台提供的设备密钥", serverUrl: this.serverUrl, deviceSuffix: this.device.suffix, tenantId: null, keyPrefix: null, expiresAt: null, refreshAfter: null, leaseExpiresAt: null, lastVerifiedAt: this.state.lastVerifiedAt || null, lastNetworkError: this.lastNetworkError};
    if (process.env.LINGFRAME_LICENSE_BYPASS === "1") return {...base, usable: true, state: "test_bypass", reason: null, tenantId: "test-tenant"};
    if (!this.state.grant || !this.state.licenseId || !this.state.activationToken) return base;
    const grant = this.decodeGrant(this.state.grant);
    if (!grant) return {...base, state: "invalid_grant", reason: "本机授权签名无效，请重新激活", keyPrefix: this.state.keyPrefix || null};
    const restriction = this.state.restriction && typeof this.state.restriction === "object" ? this.state.restriction : null;
    if (restriction && ["revoked", "expired", "verification_required"].includes(String(restriction.state))) {
      const state = String(restriction.state);
      return {...base, state, reason: restriction.reason || (state === "revoked" ? "当前密钥已被停用" : state === "expired" ? "密钥使用期已结束" : "授权需要联网复核"), tenantId: grant.tenantId, licenseId: grant.licenseId, keyPrefix: grant.keyPrefix, expiresAt: grant.licenseExpiresAt || null, refreshAfter: grant.refreshAfter, leaseExpiresAt: grant.leaseExpiresAt, lastVerifiedAt: this.state.lastVerifiedAt || null};
    }
    const wallNow = Date.now();
    const lastServerTimeMs = Number(this.state.lastServerTimeMs || 0);
    if (lastServerTimeMs && wallNow + 5 * 60_000 < lastServerTimeMs) {
      return {...base, state: "clock_rollback_detected", reason: "检测到系统时间异常，请恢复正确时间并联网复核", tenantId: grant.tenantId, licenseId: grant.licenseId, keyPrefix: grant.keyPrefix, expiresAt: grant.licenseExpiresAt || null, refreshAfter: grant.refreshAfter, leaseExpiresAt: grant.leaseExpiresAt, lastVerifiedAt: this.state.lastVerifiedAt || null};
    }
    const now = Math.max(wallNow, lastServerTimeMs);
    const expiresAt = grant.licenseExpiresAt ? Date.parse(grant.licenseExpiresAt) : Infinity;
    const leaseExpiresAt = Date.parse(grant.leaseExpiresAt);
    const usable = now < expiresAt && now < leaseExpiresAt;
    return {...base, usable, state: usable ? "active" : (now >= expiresAt ? "expired" : "offline_grace_expired"), reason: usable ? null : (now >= expiresAt ? "密钥使用期已结束" : "离线宽限已结束，请联网复核"), tenantId: grant.tenantId, licenseId: grant.licenseId, keyPrefix: grant.keyPrefix, expiresAt: grant.licenseExpiresAt || null, refreshAfter: grant.refreshAfter, leaseExpiresAt: grant.leaseExpiresAt, lastVerifiedAt: this.state.lastVerifiedAt || null};
  }
  credentials() {
    return {licenseId: this.state.licenseId || "", activationToken: this.state.activationToken || "", deviceHash: this.device.hash, fingerprintVersion: this.device.version, appId: this.appId, appVersion: this.appVersion};
  }
  async activate(key) {
    const normalized = String(key || "").trim().toUpperCase();
    if (!/^DOLA(?:-[A-HJ-NP-Z2-9]{4}){5}$/.test(normalized)) { const error = new Error("密钥格式无效"); error.code = "INVALID_KEY"; throw error; }
    const requestBody = {key: normalized, deviceHash: this.device.hash, fingerprintVersion: this.device.version, appId: this.appId, appVersion: this.appVersion};
    let result = null;
    let payload = null;
    let lastError = null;
    for (const serverUrl of this.serverUrls) {
      try {
        const candidate = await this.requestFn(serverUrl, "/api/v1/activate", requestBody);
        const decoded = this.decodeGrant(candidate.grant);
        if (!decoded) {
          const error = new Error("密钥中心签名校验失败");
          error.code = "INVALID_SERVER_SIGNATURE";
          lastError = error;
          continue;
        }
        this.serverUrl = serverUrl;
        result = candidate;
        payload = decoded;
        break;
      } catch (error) {
        lastError = error;
        if (error?.status && error.status < 500) throw error;
      }
    }
    if (!payload || !result) throw lastError || Object.assign(new Error("密钥中心签名校验失败"), {code: "INVALID_SERVER_SIGNATURE"});
    this.state = {version: 1, licenseId: payload.licenseId, activationToken: result.activationToken, deviceHash: this.device.hash, keyPrefix: payload.keyPrefix, grant: result.grant, lastServerTimeMs: Date.parse(payload.serverTime), lastVerifiedAt: new Date().toISOString()};
    this.lastNetworkError = null;
    this.save();
    return this.status();
  }
  async refresh() {
    if (process.env.LINGFRAME_LICENSE_BYPASS === "1") return this.status();
    if (!this.state.licenseId || !this.state.activationToken) { const error = new Error("本机尚未激活"); error.code = "NOT_ACTIVATED"; throw error; }
    try {
      const result = await this.requestAny("/api/v1/verify", {licenseId: this.state.licenseId, activationToken: this.state.activationToken, deviceHash: this.device.hash, fingerprintVersion: this.device.version, appId: this.appId, appVersion: this.appVersion});
      const payload = this.decodeGrant(result.grant);
      if (!payload) { const error = new Error("密钥中心签名校验失败"); error.code = "INVALID_SERVER_SIGNATURE"; throw error; }
      this.state.grant = result.grant;
      this.state.lastServerTimeMs = Date.parse(payload.serverTime);
      this.state.lastVerifiedAt = new Date().toISOString();
      delete this.state.restriction;
      this.lastNetworkError = null;
      this.save();
      return this.status();
    } catch (error) {
      this.lastNetworkError = String(error.message || error);
      const code = String(error?.code || "").toUpperCase();
      const httpStatus = Number(error?.status || 0);
      let state = null;
      if (code === "LICENSE_REVOKED") state = "revoked";
      else if (code === "LICENSE_EXPIRED") state = "expired";
      else if (httpStatus === 401 || httpStatus === 403) state = "verification_required";
      if (state) {
        this.state.restriction = {state, code: error.code || "LICENSE_SERVER_REJECTED", reason: clean(error.message || "授权中心拒绝本机授权"), recordedAt: new Date().toISOString()};
        this.save();
      }
      throw error;
    }
  }
  clear() { this.state = {}; this.lastNetworkError = null; try { fs.rmSync(this.file, {force: true}); } catch {} return this.status(); }
}

module.exports = {LicenseClient, deviceFingerprint, requestJson, APP_ID, PUBLIC_KEY};
