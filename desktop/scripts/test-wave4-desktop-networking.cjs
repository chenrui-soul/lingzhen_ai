"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {DesktopAuthClient} = require("../src/main/desktop-auth-client.cjs");
const {DesktopCloudSync} = require("../src/main/desktop-cloud-sync.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");
const {DoubaoAccountRegistry} = require("../src/main/doubao-account-registry.cjs");

const checks = [];
async function check(name, run) {
  try { await run(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: error.stack || String(error)}); }
}

function safeStorage() {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(`enc:${value}`),
    decryptString: (value) => String(value).replace(/^enc:/, ""),
  };
}

function authClient(root, fetchFn = async () => { throw new Error("unexpected request"); }) {
  return new DesktopAuthClient({
    dataRoot: root,
    appVersion: "0.12.5",
    safeStorage: safeStorage(),
    fetchFn,
    device: {hash: "a".repeat(64), version: 1, suffix: "wave4"},
  });
}

function session(expiresAt = Date.now() + 15 * 60_000) {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessTokenExpiresAt: new Date(expiresAt).toISOString(),
    refreshTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60_000).toISOString(),
    session: {membershipId: "membership-1"},
    user: {id: "user-1", username: "wave4", email: "wave4@example.com"},
    tenant: {id: "tenant-1", code: "tenant", displayName: "Tenant"},
    role: "member",
    permissions: ["desktop.bootstrap", "project.use", "asset.use", "task.use", "creation.use", "doubao_account.use", "sync.use"],
    featurePolicies: {},
  };
}

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-wave4-"));

  await check("access token refresh is deduplicated and timer is cleared on logout", async () => {
    let refreshCalls = 0;
    const client = authClient(path.join(root, "auth"), async (url) => {
      if (!url.endsWith("/api/v1/auth/refresh")) throw new Error(`unexpected ${url}`);
      refreshCalls++;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return {ok: true, status: 200, json: async () => ({status: "authenticated", ...session(Date.now() + 30 * 60_000), accessToken: "new-access", refreshToken: "new-refresh"})};
    });
    client.session = session(Date.now() + 30_000);
    client.scheduleRefresh();
    assert(client.refreshTimer);
    await Promise.all([client.refresh({loadWorkspace: false}), client.refresh({loadWorkspace: false})]);
    assert.equal(refreshCalls, 1);
    client.clearLocal();
    assert.equal(client.refreshTimer, null);
  });

  await check("authenticated request retries one 401 after refresh", async () => {
    let businessCalls = 0;
    let refreshCalls = 0;
    const client = authClient(path.join(root, "request"), async (url) => {
      if (url.endsWith("/api/v1/auth/refresh")) {
        refreshCalls++;
        return {ok: true, status: 200, json: async () => ({status: "authenticated", ...session(), accessToken: "rotated", refreshToken: "rotated-refresh"})};
      }
      businessCalls++;
      if (businessCalls === 1) return {ok: false, status: 401, json: async () => ({code: "AUTHENTICATION_REQUIRED"})};
      return {ok: true, status: 200, json: async () => ({revision: 0, snapshot: {}})};
    });
    client.session = session();
    const response = await client.authenticatedRequest("/api/v1/desktop/workspace/snapshot", {method: "GET"});
    assert.equal(response.revision, 0);
    assert.equal(refreshCalls, 1);
    assert.equal(businessCalls, 2);
    client.clearLocal();
  });

  await check("workbench cloud snapshot strips local files and secrets", () => {
    const tenantRoot = path.join(root, "workbench");
    const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot, tenantIdProvider: () => "tenant-1"});
    const snapshot = bridge.cloudSnapshot({
      currentProjectId: "project-1",
      projects: [{id: "project-1", name: "项目", updatedAt: new Date().toISOString()}],
      assets: [{id: "asset-1", projectId: "project-1", path: "C:\\private\\image.png", fileUrl: "file:///private/image.png", name: "人物图"}],
      textConversations: [{id: "conversation-1", content: "保留对话正文", accessToken: "never-upload"}],
      tasks: [{id: "task-1", videoVid: "vid-ok", resultVid: "https://signed.example/video?token=secret"}],
    });
    const json = JSON.stringify(snapshot);
    assert(json.includes("project-1"));
    assert(json.includes("保留对话正文"));
    assert(json.includes("vid-ok"));
    assert(!json.includes("C:\\\\private"));
    assert(!json.includes("file:///"));
    assert(!json.includes("never-upload"));
    assert(!json.includes("signed.example"));
  });

  await check("doubao registry rejects another user sharing the same tenant root", () => {
    const tenantRoot = path.join(root, "accounts");
    let userId = "user-a";
    const registry = new DoubaoAccountRegistry({
      tenantRootProvider: () => tenantRoot,
      tenantIdProvider: () => "tenant-1",
      userIdProvider: () => userId,
    });
    registry.upsert({id: "account-a", name: "账号 A"});
    assert.equal(registry.list().length, 1);
    userId = "user-b";
    assert.deepEqual(registry.list(), []);
    assert.throws(() => registry.assert("account-a"), /当前用户/);
  });

  await check("cloud conflict keeps local snapshot pending and never overwrites silently", async () => {
    const calls = [];
    const fakeAuth = {
      status: () => ({workspaceReady: true, user: {id: "user-1"}, tenant: {id: "tenant-1"}}),
      authenticatedRequest: async (pathname, options = {}) => {
        calls.push({pathname, method: options.method || "POST"});
        if (pathname.endsWith("/doubao-accounts")) return [];
        if (options.method === "PUT") {
          const error = new Error("conflict"); error.status = 409; error.code = "DESKTOP_WORKSPACE_CONFLICT"; throw error;
        }
        return {revision: 4, snapshot: {projects: []}};
      },
    };
    const sync = new DesktopCloudSync({authClient: fakeAuth, workspaceProvider: () => ({projects: [{id: "local"}]}), accountProvider: () => [], debounceMs: 5});
    await sync.activate();
    await sync.flush();
    assert.equal(sync.status().conflict.remoteRevision, 4);
    assert(sync.pendingWorkspace);
    assert(calls.some((call) => call.method === "PUT"));
    sync.dispose();
  });

  await check("main process scopes runtime by user and tenant", () => {
    const source = fs.readFileSync(path.join(__dirname, "../src/main/main.cjs"), "utf8");
    assert(source.includes(".user-scope-v1.json"));
    assert(source.includes("desktopIdentity.userId()"));
    assert(source.includes("tenantRuntimeScope"));
    assert(source.includes("DesktopCloudSync"));
  });

  const failed = checks.filter((item) => !item.ok);
  console.log(JSON.stringify({test: "wave4-desktop-networking", total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks}, null, 2));
  fs.rmSync(root, {recursive: true, force: true});
  if (failed.length) process.exitCode = 1;
})();
