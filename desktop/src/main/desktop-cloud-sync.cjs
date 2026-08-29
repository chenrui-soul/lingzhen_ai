"use strict";

const WORKSPACE_PATH = "/api/v1/desktop/workspace/snapshot";
const ACCOUNTS_PATH = "/api/v1/desktop/doubao-accounts";

class DesktopCloudSync {
  constructor({authClient, workspaceProvider, accountProvider, debounceMs = 800}) {
    this.authClient = authClient;
    this.workspaceProvider = workspaceProvider;
    this.accountProvider = accountProvider;
    this.debounceMs = debounceMs;
    this.timer = null;
    this.activeScope = "";
    this.revision = 0;
    this.remoteAccountIds = new Set();
    this.pendingAccountDeletes = new Set();
    this.pendingWorkspace = null;
    this.running = null;
    this.lastError = null;
    this.conflict = null;
    this.lastSyncedAt = null;
  }

  scope() {
    const status = this.authClient.status();
    return status.workspaceReady ? `${status.user?.id || ""}:${status.tenant?.id || ""}` : "";
  }

  async activate() {
    const scope = this.scope();
    if (!scope) return this.deactivate();
    if (scope !== this.activeScope) {
      this.activeScope = scope;
      this.revision = 0;
      this.remoteAccountIds = new Set();
      this.pendingAccountDeletes = new Set();
      this.conflict = null;
      try {
        const [snapshot, accounts] = await Promise.all([
          this.authClient.authenticatedRequest(WORKSPACE_PATH, {method: "GET"}),
          this.authClient.authenticatedRequest(ACCOUNTS_PATH, {method: "GET"}),
        ]);
        this.revision = Math.max(0, Number(snapshot?.revision) || 0);
        this.remoteAccountIds = new Set((Array.isArray(accounts) ? accounts : [])
          .map((item) => String(item?.accountId || "")).filter(Boolean));
      } catch (error) {
        this.lastError = this.publicError(error);
      }
    }
    this.scheduleWorkspace(this.workspaceProvider?.());
    this.scheduleAccounts(this.accountProvider?.());
    return this.status();
  }

  deactivate() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.activeScope = "";
    this.pendingWorkspace = null;
    this.revision = 0;
    this.remoteAccountIds = new Set();
    this.pendingAccountDeletes = new Set();
    this.conflict = null;
    return this.status();
  }

  scheduleWorkspace(snapshot) {
    if (!this.scope() || !snapshot || typeof snapshot !== "object") return;
    this.pendingWorkspace = snapshot;
    this.schedule();
  }

  scheduleAccounts(event = null) {
    if (!this.scope()) return;
    if (event?.type === "remove" && event.accountId) this.pendingAccountDeletes.add(String(event.accountId));
    this.schedule();
  }

  schedule() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush().catch(() => {});
    }, this.debounceMs);
    this.timer.unref?.();
  }

  async flush() {
    if (this.running) return this.running;
    const scope = this.scope();
    if (!scope || scope !== this.activeScope || this.conflict) return this.status();
    this.running = this.flushOnce(scope).finally(() => { this.running = null; });
    return this.running;
  }

  async flushOnce(scope) {
    try {
      if (this.pendingWorkspace) {
        const snapshot = this.pendingWorkspace;
        this.pendingWorkspace = null;
        try {
          const saved = await this.authClient.authenticatedRequest(WORKSPACE_PATH, {
            method: "PUT",
            body: {expectedRevision: this.revision, snapshot},
          });
          if (scope !== this.scope()) return this.status();
          this.revision = Number(saved?.revision) || this.revision;
        } catch (error) {
          if (Number(error?.status || 0) === 409 || error?.code === "DESKTOP_WORKSPACE_CONFLICT") {
            const remote = await this.authClient.authenticatedRequest(WORKSPACE_PATH, {method: "GET"});
            this.conflict = {
              code: "DESKTOP_WORKSPACE_CONFLICT",
              localExpectedRevision: this.revision,
              remoteRevision: Number(remote?.revision) || 0,
              detectedAt: new Date().toISOString(),
            };
            this.pendingWorkspace = snapshot;
            return this.status();
          }
          this.pendingWorkspace = snapshot;
          throw error;
        }
      }
      await this.syncAccounts(scope);
      this.lastSyncedAt = new Date().toISOString();
      this.lastError = null;
    } catch (error) {
      this.lastError = this.publicError(error);
      if (scope === this.scope() && !this.conflict && !this.timer) {
        this.timer = setTimeout(() => {
          this.timer = null;
          this.flush().catch(() => {});
        }, 5_000);
        this.timer.unref?.();
      }
    }
    return this.status();
  }

  async syncAccounts(scope) {
    const providedAccounts = this.accountProvider?.();
    const accounts = Array.isArray(providedAccounts) ? providedAccounts : [];
    const localIds = new Set();
    for (const item of accounts.slice(0, 50)) {
      if (scope !== this.scope()) return;
      const accountId = String(item?.id || item?.accountId || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(accountId)) continue;
      localIds.add(accountId);
      await this.authClient.authenticatedRequest(`${ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`, {
        method: "PUT",
        body: {
          displayName: String(item?.name || item?.displayName || accountId).trim().slice(0, 100),
          loginState: ["logged_in", "logged_out", "verification_required"].includes(item?.loginState)
            ? item.loginState : "unknown",
          loginSummary: String(item?.loginSummary || "").trim().slice(0, 300) || null,
          lastCheckedAt: item?.lastCheckedAt || null,
        },
      });
    }
    for (const accountId of this.pendingAccountDeletes) {
      if (scope !== this.scope()) return;
      if (!localIds.has(accountId)) {
        await this.authClient.authenticatedRequest(`${ACCOUNTS_PATH}/${encodeURIComponent(accountId)}`, {
          method: "DELETE",
        });
      }
    }
    this.pendingAccountDeletes.clear();
    this.remoteAccountIds = localIds;
  }

  publicError(error) {
    return {
      code: error?.code || "DESKTOP_SYNC_FAILED",
      message: error?.message || "桌面数据同步失败",
      at: new Date().toISOString(),
    };
  }

  status() {
    return {
      active: Boolean(this.activeScope),
      revision: this.revision,
      pending: Boolean(this.pendingWorkspace || this.timer || this.running),
      conflict: this.conflict,
      lastError: this.lastError,
      lastSyncedAt: this.lastSyncedAt,
    };
  }

  dispose() { this.deactivate(); }
}

module.exports = {DesktopCloudSync, WORKSPACE_PATH, ACCOUNTS_PATH};
