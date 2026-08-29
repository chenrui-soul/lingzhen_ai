"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const {BrowserController} = require("./browser-controller.cjs");

const VERSION = "0.2.0";

class AgentBridge {
  constructor({dataRoot, licenseClient, identityProvider = null, initialConfig = null, profileRootProvider, embeddedBrowserProvider = null, accountAuthorizer = null, serverUrl = process.env.LINGFRAME_AGENT_SERVER_URL || "http://127.0.0.1:53188", serverUrls = null, testMode = false}) {
    this.dataRoot = dataRoot;
    this.licenseClient = licenseClient;
    this.identityProvider = identityProvider;
    this.boundTenantId = String((identityProvider ? identityProvider() : licenseClient.status()).tenantId || "");
    this.accountAuthorizer = typeof accountAuthorizer === "function" ? accountAuthorizer : account => account;
    this.serverUrls = [...new Set((Array.isArray(serverUrls) && serverUrls.length ? serverUrls : [serverUrl]).map(value => String(value || "").trim().replace(/\/+$/, "")).filter(Boolean))];
    this.serverUrl = this.serverUrls[0] || String(serverUrl).replace(/\/+$/, "");
    this.configFile = path.join(dataRoot, "agent-config.json");
    this.idFile = path.join(dataRoot, "agent-id.txt");
    this.running = false;
    this.stopped = false;
    this.lifecycleGeneration = 0;
    this.loopPromise = null;
    this.requestControllers = new Set();
    this.last = {online: false, configured: false, pendingCommands: 0};
    this.agentId = this.readId();
    this.config = this.loadConfig();
    if ((!this.config.agentToken || this.config.agentToken.length < 32) && initialConfig?.agentToken) {
      this.config = {...initialConfig};
      this.saveConfig(this.config);
    }
    if ((!Array.isArray(serverUrls) || !serverUrls.length) && this.config.serverUrl) this.setServerUrls([this.config.serverUrl]);
    this.browser = new BrowserController({
      profileRootProvider,
      downloadRootProvider: () => {
        const root = profileRootProvider && profileRootProvider();
        return root ? path.join(path.dirname(root), "downloads") : null;
      },
      browserExe: this.config.browserExe || "",
      embeddedBrowserProvider,
      testMode,
    });
  }
  setServerUrls(values) {
    const urls = [...new Set((Array.isArray(values) ? values : [values]).map(value => String(value || "").trim().replace(/\/+$/, "")).filter(value => /^https?:\/\//i.test(value)))];
    if (!urls.length) return this.serverUrls;
    this.serverUrls = urls;
    if (!urls.includes(this.serverUrl)) this.serverUrl = urls[0];
    return [...this.serverUrls];
  }
  readId() {
    try { const id = fs.readFileSync(this.idFile, "utf8").trim(); if (id) return id; } catch {}
    const id = crypto.randomUUID();
    fs.mkdirSync(this.dataRoot, {recursive: true});
    fs.writeFileSync(this.idFile, id, {encoding: "utf8", mode: 0o600});
    return id;
  }
  loadConfig() { try { return JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch { return {}; } }
  saveConfig(config) {
    this.config = {...config};
    fs.mkdirSync(this.dataRoot, {recursive: true});
    const tmp = `${this.configFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.config, null, 2), {encoding: "utf8", mode: 0o600});
    fs.renameSync(tmp, this.configFile);
    try { fs.chmodSync(this.configFile, 0o600); } catch {}
  }
  status() {
    return {...this.last, agentId: this.agentId, deviceName: this.config.deviceName || os.hostname(), serverUrl: this.serverUrl, version: VERSION};
  }
  assertActiveTenant(expectedGeneration = this.lifecycleGeneration) {
    if(this.stopped){const error=new Error("旧 Agent 执行上下文已停止");error.code="AGENT_STOPPED";throw error;}
    if(expectedGeneration!==this.lifecycleGeneration){const error=new Error("Agent 生命周期已更新，旧请求已停止");error.code="AGENT_CONTEXT_CHANGED";throw error;}
    const currentTenantId=String((this.identityProvider?this.identityProvider():this.licenseClient.status()).tenantId||"");
    if(!this.boundTenantId||currentTenantId!==this.boundTenantId){const error=new Error("租户身份已切换，旧 Agent 执行上下文已停止");error.code="TENANT_CONTEXT_CHANGED";throw error;}
    return currentTenantId;
  }
  assertUsableIdentity() {
    const identity=this.identityProvider?this.identityProvider():this.licenseClient.status();
    if(!identity?.usable){const error=new Error(identity?.reason||"客户端授权已失效，Agent 已停止执行新命令");error.code=identity?.license?.state==="expired"?"LICENSE_EXPIRED":"LICENSE_NOT_USABLE";throw error;}
    return identity;
  }
  configure(input = {}) {
    const token = String(input.agentToken || "").trim();
    if (token.length < 32) { const error = new Error("专属桌面客户端令牌无效"); error.code = "INVALID_AGENT_TOKEN"; throw error; }
    this.stop();
    if (input.serverUrl) this.setServerUrls([input.serverUrl, ...this.serverUrls]);
    this.saveConfig({agentToken: token, serverUrl: this.serverUrl, deviceName: String(input.deviceName || os.hostname()).slice(0, 120), browserExe: String(input.browserExe || "").trim()});
    this.browser.configuredBrowser = this.config.browserExe;
    this.start();
    return this.status();
  }
  body(extra = {}) {
    return {agentId: this.agentId, deviceName: this.config.deviceName || os.hostname(), version: VERSION, capabilities: ["browser-open", "login-detect", "isolated-profile", "manual-verification", "video-capture", "video-download", "video-validation"], ...extra};
  }
  async request(pathname, body, timeout = 30000) {
    const generation=this.lifecycleGeneration;this.assertActiveTenant(generation);
    let lastError;
    for (const serverUrl of this.serverUrls) {
      const controller = new AbortController();
      this.requestControllers.add(controller);
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const response = await fetch(`${serverUrl}${pathname}`, {method: "POST", headers: {"Content-Type": "application/json", "x-agent-token": this.config.agentToken}, body: JSON.stringify(body || {}), signal: controller.signal});
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { const error = new Error(data.error || `Agent 服务返回 ${response.status}`); error.status = response.status; throw error; }
        this.serverUrl = serverUrl;
        this.assertActiveTenant(generation);
        return data;
      } catch (error) {
        lastError = error;
        this.assertActiveTenant(generation);
        if (error?.status && error.status < 500) throw error;
      } finally { clearTimeout(timer);this.requestControllers.delete(controller); }
    }
    throw lastError || new Error("Agent 服务连接失败");
  }
  async uploadResult(command, localPath) {
    const generation=this.lifecycleGeneration;this.assertActiveTenant(generation);
    const stat = fs.statSync(localPath);
    let lastError;
    for (const serverUrl of this.serverUrls) {
      const controller=new AbortController();this.requestControllers.add(controller);
      try {
        const response = await fetch(`${serverUrl}/agent/v1/commands/${encodeURIComponent(command.id)}/video`, {
          method: "POST",
          headers: {"Content-Type": "video/mp4", "Content-Length": String(stat.size), "x-agent-token": this.config.agentToken, "x-job-id": String(command.payload?.jobId || command.id)},
          body: fs.createReadStream(localPath), duplex: "half",
          signal: controller.signal,
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) { const error = new Error(data.error || `视频回传返回 ${response.status}`); error.status = response.status; throw error; }
        this.serverUrl = serverUrl;
        this.assertActiveTenant(generation);return data;
      } catch (error) { lastError=error;this.assertActiveTenant(generation);if(error?.status&&error.status<500)throw error; }
      finally { this.requestControllers.delete(controller); }
    }
    throw lastError || new Error("视频回传服务连接失败");
  }
  assertTenant(serverTenantId) {
    const licensedTenant=this.assertActiveTenant();
    if(String(serverTenantId||"")!==licensedTenant){
      const error = new Error("Agent 令牌所属租户与本机授权不一致，已拒绝连接");
      error.code = "AGENT_TENANT_MISMATCH";
      throw error;
    }
  }
  async register() {
    const result = await this.request("/agent/v1/register", this.body(), 8000);
    this.assertTenant(result.tenantId);
    this.last = {...this.last, online: true, configured: true, tenantId: result.tenantId, lastSeenAt: new Date().toISOString(), reason: null};
    return result;
  }
  async acquireToken() {
    const generation=this.lifecycleGeneration;this.assertActiveTenant(generation);
    const credentials = this.licenseClient.credentials();
    if (!credentials.licenseId || !credentials.activationToken) return false;
    let lastError;
    for (const serverUrl of this.serverUrls) {
      const controller=new AbortController();this.requestControllers.add(controller);
      try {
        const response = await fetch(`${serverUrl}/desktop/v1/agent-token`, {method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify(credentials),signal:controller.signal});
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data.agentToken) { const error = new Error(data.error || `桌面绑定服务返回 ${response.status}`); error.code = data.code || "AGENT_TOKEN_EXCHANGE_FAILED"; error.status = response.status; throw error; }
        this.serverUrl = serverUrl;
        this.assertActiveTenant(generation);
        this.saveConfig({...(this.config || {}), agentToken: String(data.agentToken), deviceName: this.config.deviceName || os.hostname(), browserExe: this.config.browserExe || "", tokenSource: "license-grant"});
        return true;
      } catch (error) { lastError=error;this.assertActiveTenant(generation);if(error?.status&&error.status<500)throw error; }
      finally { this.requestControllers.delete(controller); }
    }
    throw lastError || new Error("桌面绑定服务连接失败");
  }
  async pollOnce() {
    const generation=this.lifecycleGeneration;
    this.assertUsableIdentity();
    const result = await this.request("/agent/v1/poll", this.body(), 35000);
    this.assertActiveTenant(generation);
    if (result.tenantId) this.assertTenant(result.tenantId);
    const command = result.command;
    if (!command) return null;
    this.last = {...this.last, pendingCommands: 1, lastCommandAt: new Date().toISOString()};
    let commandResult;
    try {
      this.assertUsableIdentity();
      const authorizedCommand = command.account ? {...command, account: this.accountAuthorizer(command.account)} : command;
      commandResult = await this.browser.execute(authorizedCommand);
      if (commandResult?.ok !== false && commandResult?.resultPath && commandResult?.state === "completed") {
        const uploaded = await this.uploadResult(command, commandResult.resultPath);
        commandResult = {...commandResult, localResultPath: commandResult.resultPath, resultPath: uploaded.resultPath, resultUrl: uploaded.resultUrl, uploadAudit: uploaded.uploadAudit};
      }
    }
    catch (error) { commandResult = {ok: false, error: String(error.message || error), code: error.code || "COMMAND_FAILED"}; }
    await this.request(`/agent/v1/commands/${encodeURIComponent(command.id)}/result`, this.body(commandResult), 15000);
    this.last = {...this.last, pendingCommands: 0, lastCommandResult: commandResult, lastSeenAt: new Date().toISOString()};
    return commandResult;
  }
  async runLoop(generation) {
    while (this.running&&generation===this.lifecycleGeneration) {
      const identity = this.identityProvider ? this.identityProvider() : this.licenseClient.status();
      if (!identity.usable) {
        this.last = {...this.last, online: false, configured: Boolean(this.config.agentToken), reason: "等待有效授权"};
        await new Promise(resolve => setTimeout(resolve, 3000));
        continue;
      }
      if (!this.config.agentToken) {
        try { await this.acquireToken(); }
        catch (error) { this.last = {...this.last, online: false, configured: false, reason: String(error.message || error), errorCode: error.code || null}; await new Promise(resolve => setTimeout(resolve, 5000)); continue; }
      }
      try {
        await this.register();
        while(this.running&&generation===this.lifecycleGeneration){const current=this.identityProvider?this.identityProvider():this.licenseClient.status();if(!current.usable)break;await this.pollOnce();}
      } catch (error) {
        this.last = {...this.last, online: false, configured: true, pendingCommands: 0, reason: String(error.message || error), errorCode: error.code || null};
        if(this.running&&generation===this.lifecycleGeneration)await new Promise(resolve=>setTimeout(resolve,5000));
      }
    }
  }
  start() {
    if (this.running) return;
    this.stopped = false;
    this.running = true;
    const generation=++this.lifecycleGeneration;
    this.loopPromise=this.runLoop(generation);
  }
  stop() {
    this.running = false;
    this.stopped = true;
    this.lifecycleGeneration+=1;
    for(const controller of this.requestControllers)controller.abort();
    this.requestControllers.clear();
    this.browser.closeAll();
  }
  async openAccount(account) { const generation=this.lifecycleGeneration;this.assertUsableIdentity();this.assertActiveTenant(generation);const result=await this.browser.execute({action:"open",account:this.accountAuthorizer(account)});this.assertActiveTenant(generation);return result; }
  async detectAccount(account) { const generation=this.lifecycleGeneration;this.assertUsableIdentity();this.assertActiveTenant(generation);const result=await this.browser.execute({action:"detect",account:this.accountAuthorizer(account)});this.assertActiveTenant(generation);return result; }
  closeAccount(account) { this.assertActiveTenant();const authorized=this.accountAuthorizer(account);return this.browser.closeAccount(authorized,{force:true}); }
}

module.exports = {AgentBridge};
