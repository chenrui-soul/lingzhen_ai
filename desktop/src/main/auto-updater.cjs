"use strict";

const fs = require("fs");
const path = require("path");
const {normalizeUpdateUrl, blockingTasks} = require("./update-policy.cjs");

class AutoUpdaterManager {
  constructor({app, windowProvider, dataRootProvider, taskProvider, configFile, updater = null} = {}) {
    this.app = app;
    this.windowProvider = windowProvider;
    this.dataRootProvider = dataRootProvider;
    this.taskProvider = taskProvider;
    this.configFile = configFile || path.join(__dirname, "../../assets/update-config.json");
    this.updater = updater;
    this.config = this.readConfig();
    this.url = normalizeUpdateUrl(process.env.LINGFRAME_UPDATE_URL || this.config.url, {allowPublicHttp: this.allowPublicHttp()});
    this.enabled = this.config.enabled !== false && Boolean(this.url);
    this.started = false;
    this.downloaded = false;
    this.lastBackup = null;
    this.checkTimer = null;
    this.checkInterval = null;
    this.statusValue = {enabled: this.enabled, configured: Boolean(this.url), state: this.enabled ? "idle" : "unconfigured", version: this.app?.getVersion?.() || "", updateInfo: null, progress: 0, blockedReason: "", lastCheckedAt: null, error: ""};
    this.onUpdateAvailable = this.onUpdateAvailable.bind(this);
    this.onUpdateNotAvailable = this.onUpdateNotAvailable.bind(this);
    this.onDownloadProgress = this.onDownloadProgress.bind(this);
    this.onUpdateDownloaded = this.onUpdateDownloaded.bind(this);
    this.onError = this.onError.bind(this);
  }

  readConfig() { try { return JSON.parse(fs.readFileSync(this.configFile, "utf8")); } catch { return {version: 1, enabled: false, url: "", channel: "stable", allowPublicHttp: false}; } }
  updaterInstance() { if (!this.updater) this.updater = require("electron-updater").autoUpdater; return this.updater; }
  allowPublicHttp() { return this.config.allowPublicHttp === true || process.env.LINGFRAME_ALLOW_PUBLIC_HTTP === "1"; }
  send(statusPatch = {}) {
    this.statusValue = {...this.statusValue, ...statusPatch};
    const target = this.windowProvider?.();
    if (target && !target.isDestroyed?.()) target.webContents.send("app:update-status", {...this.statusValue});
    return {...this.statusValue};
  }
  status() { return {...this.statusValue}; }
  safeError(error) { return String(error?.message || error || "更新失败").replace(/https?:\/\/[^\s"']+/gi, "[更新服务地址已隐藏]"); }
  currentBlockingTasks() { return blockingTasks(this.taskProvider?.() || []); }
  taskBlockReason() {
    const tasks = this.currentBlockingTasks();
    if (!tasks.length) return "";
    const manual = tasks.some(task => ["awaiting_login", "awaiting_verification", "submission_unknown", "paused"].includes(task.state));
    return manual ? "当前有等待人工处理的任务，请完成处理后再安装更新" : `当前有 ${tasks.length} 个任务正在执行，请等待任务结束后再安装更新`;
  }
  backupJsonData() {
    const root = this.dataRootProvider?.();
    if (!root || !fs.existsSync(root)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const destination = path.join(this.app.getPath("userData"), "backups", `update-${stamp}`);
    const roots = [path.join(root, "database"), path.join(this.app.getPath("userData"), "system")];
    let copied = 0;
    const copy = source => {
      if (!fs.existsSync(source)) return;
      for (const entry of fs.readdirSync(source, {withFileTypes: true})) {
        const from = path.join(source, entry.name);
        const relative = path.relative(this.app.getPath("userData"), from);
        const to = path.join(destination, relative);
        if (entry.isDirectory()) copy(from);
        else if (entry.isFile() && /\.json$/i.test(entry.name)) { fs.mkdirSync(path.dirname(to), {recursive: true}); fs.copyFileSync(from, to); copied += 1; }
      }
    };
    roots.forEach(copy);
    if (!copied) { fs.rmSync(destination, {recursive: true, force: true}); return null; }
    this.lastBackup = destination;
    return destination;
  }
  start() {
    if (this.started) return this.status();
    this.started = true;
    if (!this.enabled || (!this.app.isPackaged && process.env.LINGFRAME_UPDATE_ALLOW_DEV !== "1")) return this.send({state: this.enabled ? "dev-disabled" : "unconfigured"});
    const updater = this.updaterInstance();
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.allowPrerelease = this.config.channel === "beta";
    updater.setFeedURL({provider: "generic", url: this.url});
    updater.on("update-available", this.onUpdateAvailable);
    updater.on("update-not-available", this.onUpdateNotAvailable);
    updater.on("download-progress", this.onDownloadProgress);
    updater.on("update-downloaded", this.onUpdateDownloaded);
    updater.on("error", this.onError);
    this.checkTimer = setTimeout(() => this.check(false).catch(() => {}), Number(this.config.initialCheckDelayMs || 12000));
    this.checkInterval = setInterval(() => this.check(false).catch(() => {}), Math.max(300000, Number(this.config.checkIntervalMs || 21600000)));
    this.checkInterval.unref?.();
    return this.send({state: "ready"});
  }
  async check(manual = true) {
    if (!this.enabled) return this.send({state: "unconfigured", error: "尚未配置更新服务器"});
    if (!this.app.isPackaged && process.env.LINGFRAME_UPDATE_ALLOW_DEV !== "1") return this.send({state: "dev-disabled"});
    this.send({state: "checking", error: "", lastCheckedAt: new Date().toISOString()});
    try { await this.updaterInstance().checkForUpdates(); return this.status(); }
    catch (error) { return this.send({state: "error", error: this.safeError(error), manual}); }
  }
  async download() {
    if (!this.enabled) return this.send({state: "unconfigured", error: "尚未配置更新服务器"});
    try {
      this.send({state: "downloading", progress: 0, blockedReason: "", error: ""});
      await this.updaterInstance().downloadUpdate();
      return this.status();
    } catch (error) { return this.send({state: "error", error: this.safeError(error)}); }
  }
  install() {
    const reason = this.taskBlockReason();
    if (reason) return this.send({state: "blocked", blockedReason: reason});
    if (!this.downloaded) return this.send({state: "error", error: "更新包尚未下载完成"});
    const backup = this.backupJsonData();
    this.send({state: "installing", backup});
    setImmediate(() => this.updaterInstance().quitAndInstall(false, true));
    return this.status();
  }
  onUpdateAvailable(info) { this.send({state: "available", updateInfo: {version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes || ""}, progress: 0}); }
  onUpdateNotAvailable() { this.send({state: "up-to-date", updateInfo: null, progress: 0}); }
  onDownloadProgress(progress) { this.send({state: "downloading", progress: Math.max(0, Math.min(100, Number(progress.percent) || 0))}); }
  onUpdateDownloaded(info) { this.downloaded = true; this.send({state: "downloaded", progress: 100, updateInfo: {version: info.version, releaseDate: info.releaseDate, releaseNotes: info.releaseNotes || ""}}); }
  onError(error) { this.send({state: "error", error: this.safeError(error)}); }
  dispose() {
    if (this.checkTimer) clearTimeout(this.checkTimer);
    if (this.checkInterval) clearInterval(this.checkInterval);
    this.checkTimer = null;
    this.checkInterval = null;
    if (this.updater) for (const [event, handler] of [["update-available", this.onUpdateAvailable], ["update-not-available", this.onUpdateNotAvailable], ["download-progress", this.onDownloadProgress], ["update-downloaded", this.onUpdateDownloaded], ["error", this.onError]]) this.updater.removeListener(event, handler);
    this.started = false;
  }
}

module.exports = {AutoUpdaterManager};
