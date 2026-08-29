"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

function cleanUrl(value) { return String(value || "").trim().replace(/\/+$/, ""); }
function validToken(value) { return String(value || "").trim().length >= 32; }

class DesktopIdentity {
  constructor({dataRoot, licenseClient, legacyConfigPaths = null}) {
    this.dataRoot = dataRoot;
    this.licenseClient = licenseClient;
    this.file = path.join(dataRoot, "verified-agent-identity.json");
    this.legacyConfigPaths = legacyConfigPaths || [
      path.join(process.env.LOCALAPPDATA || "", "LingFrameDesktopAgent", "agent-config.json"),
    ];
    this.state = this.loadVerified();
  }
  loadJson(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
  loadVerified() {
    const value = this.loadJson(this.file);
    if (!value || !/^[0-9a-f-]{36}$/i.test(String(value.tenantId || "")) || !validToken(value.agentToken)) return {};
    return value;
  }
  saveVerified(value) {
    fs.mkdirSync(this.dataRoot, {recursive: true});
    const next = {...value, verifiedAt: new Date().toISOString()};
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(next, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(tmp, this.file);
    try { fs.chmodSync(this.file, 0o600); } catch {}
    this.state = next;
    return next;
  }
  licenseStatus() { return this.licenseClient.status(); }
  status() {
    const license = this.licenseStatus();
    if (license.usable && license.tenantId) {
      const verifiedAgent = this.state.tenantId === license.tenantId && validToken(this.state.agentToken);
      return {usable: true, source: verifiedAgent ? "device-license+verified-agent" : "device-license", tenantId: license.tenantId, serverUrl: verifiedAgent ? this.state.serverUrl : undefined, verifiedAt: verifiedAgent ? this.state.verifiedAt : undefined, license};
    }
    return {usable: false, source: null, tenantId: license.tenantId || null, reason: license.reason || "桌面身份尚未验证", license};
  }
  tenantId() { return this.status().tenantId; }
  importedConfig() {
    for (const file of this.legacyConfigPaths) {
      const config = this.loadJson(file);
      if (config && validToken(config.agentToken) && cleanUrl(config.serverUrl)) return {...config, sourceFile: file};
    }
    return null;
  }
  async verifyAgentConfig(config) {
    if (!config || !validToken(config.agentToken)) throw new Error("桌面 Agent 令牌无效");
    const serverUrl = cleanUrl(config.serverUrl);
    if (!/^https?:\/\//i.test(serverUrl)) throw new Error("桌面 Agent 服务器地址无效");
    const response = await fetch(`${serverUrl}/agent/v1/register`, {
      method: "POST",
      headers: {"Content-Type": "application/json", "x-agent-token": String(config.agentToken)},
      body: JSON.stringify({agentId: `embedded-${os.hostname()}`, deviceName: config.deviceName || os.hostname(), version: "0.5.1", capabilities: ["embedded-browser", "verified-agent-identity"]}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !/^[0-9a-f-]{36}$/i.test(String(data.tenantId || ""))) throw new Error(data.error || `服务器验证桌面身份失败：${response.status}`);
    return this.saveVerified({tenantId: String(data.tenantId).toLowerCase(), agentToken: String(config.agentToken), serverUrl, deviceName: String(config.deviceName || os.hostname()), sourceFile: config.sourceFile || "manual"});
  }
  async bootstrap() {
    const license = this.licenseStatus();
    if (!license.usable || !license.tenantId) return this.status();
    if (this.state.tenantId === license.tenantId && validToken(this.state.agentToken)) return this.status();
    const imported = this.importedConfig();
    if (!imported) return this.status();
    try { await this.verifyAgentConfig(imported); } catch {}
    return this.status();
  }
  agentConfig() {
    const status = this.status();
    if (!status.usable || !this.state.tenantId || this.state.tenantId !== status.tenantId || !validToken(this.state.agentToken)) return null;
    return {agentToken: this.state.agentToken, serverUrl: this.state.serverUrl, deviceName: this.state.deviceName, tokenSource: "verified-agent"};
  }
  clearVerified() {
    try { fs.unlinkSync(this.file); } catch (error) { if (error.code !== "ENOENT") throw error; }
    this.state = {};
    return this.status();
  }
}

module.exports = {DesktopIdentity, validToken, cleanUrl};
