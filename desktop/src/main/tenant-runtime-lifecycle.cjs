"use strict";

function runtimeIdentity(status = {}) {
  const bootstrapState = String(status?.bootstrap?.state || "");
  const identityAvailable = status?.authenticated === true
    && (status?.workspaceReady === true || bootstrapState === "loading");
  if (!identityAvailable) return null;
  const userId = String(status?.user?.id || "").trim();
  const tenantId = String(status?.tenant?.id || "").trim();
  if (!userId || !tenantId) return null;
  return {userId, tenantId, scope: `${userId}:${tenantId}`, workspaceReady: status?.workspaceReady === true};
}

class TenantRuntimeLifecycle {
  constructor({hasRuntime, createRuntime, disposeRuntime, refreshRuntime = null}) {
    if (typeof hasRuntime !== "function" || typeof createRuntime !== "function" || typeof disposeRuntime !== "function") {
      throw new Error("租户运行时生命周期依赖不完整");
    }
    this.hasRuntime = hasRuntime;
    this.createRuntime = createRuntime;
    this.disposeRuntime = disposeRuntime;
    this.refreshRuntime = typeof refreshRuntime === "function" ? refreshRuntime : null;
    this.scope = "";
  }

  sync(status = {}) {
    const next = runtimeIdentity(status);
    const runtimeExists = Boolean(this.hasRuntime());

    if (!next) {
      if (runtimeExists || this.scope) this.disposeRuntime();
      this.scope = "";
      return {action: runtimeExists ? "disposed" : "idle", scope: "", tenantId: null};
    }

    if (runtimeExists && next.scope === this.scope) {
      this.refreshRuntime?.(next);
      return {action: "reused", scope: this.scope, tenantId: next.tenantId};
    }

    if (runtimeExists || (this.scope && this.scope !== next.scope)) this.disposeRuntime();
    this.scope = "";

    if (!next.workspaceReady) {
      return {action: "waiting", scope: "", tenantId: next.tenantId};
    }

    try {
      this.createRuntime(next);
      this.scope = next.scope;
      return {action: "created", scope: this.scope, tenantId: next.tenantId};
    } catch (error) {
      this.scope = "";
      throw error;
    }
  }

  dispose() {
    const runtimeExists = Boolean(this.hasRuntime());
    if (runtimeExists || this.scope) this.disposeRuntime();
    this.scope = "";
  }
}

module.exports = {TenantRuntimeLifecycle, runtimeIdentity};
