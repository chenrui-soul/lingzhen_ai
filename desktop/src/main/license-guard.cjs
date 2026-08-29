"use strict";

const {EventEmitter} = require("events");

const ACTIVE_CAPABILITIES = new Set(["write-local", "generate", "account-control", "agent-control"]);
const RECOVERY_STATES = new Set(["expired", "offline_grace_expired", "revoked", "verification_required", "clock_rollback_detected"]);

function licenseError(status, capability) {
  const error = new Error(status?.reason || "客户端授权已失效，请续费或联网复核");
  const codes = {expired: "LICENSE_EXPIRED", revoked: "LICENSE_REVOKED", verification_required: "LICENSE_VERIFICATION_REQUIRED"};
  error.code = codes[status?.state] || "LICENSE_NOT_USABLE";
  error.licenseState = status?.state || "needs_activation";
  error.capability = capability;
  error.expiresAt = status?.expiresAt || null;
  return error;
}

class LicenseGuard extends EventEmitter {
  constructor({licenseClient, refreshFn = null, now = () => Date.now(), localCheckMs = 60_000, networkMinMs = 15_000, networkCheckMs = 5 * 60_000}) {
    super();
    this.licenseClient = licenseClient;
    this.refreshFn = refreshFn || (() => licenseClient.refresh());
    this.now = now;
    this.localCheckMs = Math.max(1_000, Number(localCheckMs) || 60_000);
    this.networkMinMs = Math.max(1_000, Number(networkMinMs) || 15_000);
    this.networkCheckMs = Math.max(this.networkMinMs, Number(networkCheckMs) || 5 * 60_000);
    this.localTimer = null;
    this.networkTimer = null;
    this.expiryTimer = null;
    this.lastRefreshError = null;
    this.last = this.snapshot();
  }
  snapshot() {
    const license = this.licenseClient.status();
    const expiresAtMs = Date.parse(String(license.expiresAt || ""));
    const remainingMs = Number.isFinite(expiresAtMs) ? expiresAtMs - this.now() : null;
    const expiring = license.usable && remainingMs !== null && remainingMs > 0 && remainingMs <= 7 * 24 * 60 * 60_000;
    return {
      ...license,
      mode: license.usable ? (expiring ? "expiring" : "active") : (license.tenantId && RECOVERY_STATES.has(license.state) ? "restricted" : "locked"),
      expiring,
      remainingMs,
      checkedAt: new Date(this.now()).toISOString(),
    };
  }
  can(capability, status = this.last || this.snapshot()) {
    if (["public", "license-manage"].includes(capability)) return true;
    if (capability === "read-local") return Boolean(status.tenantId);
    if (capability === "result-recovery") return Boolean(status.tenantId);
    if (ACTIVE_CAPABILITIES.has(capability)) return status.usable === true;
    return status.usable === true;
  }
  assert(capability = "write-local") {
    const status = this.checkLocal();
    if (!this.can(capability, status)) throw licenseError(status, capability);
    return status;
  }
  checkLocal() {
    const next = this.snapshot();
    this.apply(next);
    return next;
  }
  apply(next) {
    const previous = this.last;
    this.last = next;
    this.scheduleExpiry(next);
    if (!previous || previous.usable !== next.usable || previous.state !== next.state || previous.mode !== next.mode || previous.tenantId !== next.tenantId) {
      this.emit("change", next, previous || null);
    }
    return next;
  }
  scheduleExpiry(status) {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const points = [status.expiresAt, status.leaseExpiresAt].map(value => Date.parse(String(value || ""))).filter(Number.isFinite).filter(value => value > this.now());
    if (!points.length) return;
    const delay = Math.max(25, Math.min(...points) - this.now() + 25);
    this.expiryTimer = setTimeout(() => this.checkLocal(), Math.min(delay, 2_147_000_000));
    this.expiryTimer.unref?.();
  }
  nextNetworkDelay(status = this.last) {
    let delay = this.networkCheckMs;
    const refreshAtMs = Date.parse(String(status?.refreshAfter || ""));
    if (status?.usable && Number.isFinite(refreshAtMs)) delay = Math.min(delay, Math.max(this.networkMinMs, refreshAtMs - this.now()));
    return Math.max(this.networkMinMs, delay);
  }
  scheduleNetwork(status = this.last) {
    if (this.networkTimer) clearTimeout(this.networkTimer);
    const delay = this.nextNetworkDelay(status);
    this.networkTimer = setTimeout(async () => {
      this.networkTimer = null;
      await this.refresh();
      if (this.localTimer) this.scheduleNetwork(this.last);
    }, delay);
    this.networkTimer.unref?.();
  }
  async refresh() {
    try {
      await this.refreshFn();
      this.lastRefreshError = null;
    } catch (error) {
      this.lastRefreshError = {code: error?.code || null, status: Number(error?.status || 0) || null, message: String(error?.message || error)};
    }
    const next = this.checkLocal();
    if (this.networkTimer) this.scheduleNetwork(next);
    return next;
  }
  start() {
    if (this.localTimer || this.networkTimer) return this.checkLocal();
    this.checkLocal();
    this.localTimer = setInterval(() => this.checkLocal(), this.localCheckMs);
    this.localTimer.unref?.();
    this.scheduleNetwork(this.last);
    return this.last;
  }
  stop() {
    if (this.localTimer) clearInterval(this.localTimer);
    if (this.networkTimer) clearInterval(this.networkTimer);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.localTimer = null;
    this.networkTimer = null;
    this.expiryTimer = null;
  }
}

module.exports = {LicenseGuard, licenseError};
