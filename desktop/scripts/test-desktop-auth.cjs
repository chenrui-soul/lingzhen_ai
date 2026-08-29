"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {DesktopAuthClient} = require("../src/main/desktop-auth-client.cjs");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "desktop-auth-ground-truth.json"), "utf8"));
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-desktop-auth-"));
const results = [];
const membershipId = "55555555-5555-5555-5555-555555555555";

const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`protected:${value}`, "utf8"),
  decryptString: (buffer) => {
    const value = buffer.toString("utf8");
    if (!value.startsWith("protected:")) throw new Error("invalid encrypted value");
    return value.slice("protected:".length);
  },
};

function response(status, body) {
  return {ok: status >= 200 && status < 300, status, json: async () => body};
}

function authResponse(overrides = {}) {
  return {
    status: "authenticated",
    tokenType: "Bearer",
    accessToken: overrides.accessToken || "access-token-1",
    accessTokenExpiresAt: overrides.accessTokenExpiresAt || new Date(Date.now() + 15 * 60_000).toISOString(),
    refreshToken: overrides.refreshToken || "refresh-token-1",
    refreshTokenExpiresAt: overrides.refreshTokenExpiresAt || new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    session: {id: "44444444-4444-4444-4444-444444444444", membershipId, deviceId: "66666666-6666-6666-6666-666666666666", clientType: "desktop"},
    user: overrides.user || truth.user,
    tenant: overrides.tenant || truth.tenant,
    role: "owner",
    permissions: ["desktop.bootstrap", "creation.use"],
    featurePolicies: {"desktop.video": "enabled"},
  };
}

function bootstrapResponse(overrides = {}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    user: overrides.user || truth.user,
    tenant: overrides.tenant || truth.tenant,
    membership: {id: membershipId, role: "owner"},
    permissions: ["desktop.bootstrap", "creation.use"],
    features: {infiniteCanvas: false},
    credits: {available: false, balance: 0},
    modelCatalog: overrides.modelCatalog || {available: false, version: null, publishedAt: null},
    models: overrides.models || [],
    skills: [],
  };
}

function client(name, fetchFn, options = {}) {
  return new DesktopAuthClient({
    dataRoot: path.join(testRoot, name),
    appVersion: "0.12.5",
    safeStorage,
    serverUrl: truth.serverUrl,
    fetchFn,
    now: options.now,
    device: {version: 1, hash: truth.deviceHash, suffix: truth.deviceHash.slice(-10)},
  });
}

async function check(name, fn) {
  try { await fn(); results.push({name, passed: true}); }
  catch (error) { results.push({name, passed: false, error: error.stack || String(error)}); }
}

(async () => {
  await check("fresh client requires login", async () => {
    const auth = client("fresh", async () => { throw new Error("must not request"); });
    assert.equal(auth.status().state, truth.expected.unauthenticatedState);
    assert.equal(auth.status().authenticated, false);
    assert.equal(auth.status().workspaceReady, false);
    assert.equal(auth.status().usable, false);
  });

  await check("login loads desktop bootstrap and persists no plaintext token", async () => {
    let loginBody = null;
    let bootstrapAuthorization = "";
    const auth = client("login", async (url, options) => {
      if (url.endsWith("/auth/login")) {
        loginBody = JSON.parse(options.body);
        return response(200, authResponse());
      }
      assert.equal(url, `${truth.serverUrl}/api/v1/desktop/bootstrap`);
      assert.equal(options.method, "GET");
      bootstrapAuthorization = options.headers.Authorization;
      return response(200, bootstrapResponse());
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.state, truth.expected.authenticatedState);
    assert.equal(state.authenticated, true);
    assert.equal(state.workspaceReady, true);
    assert.equal(state.tenantId, truth.tenant.id);
    assert.equal(state.bootstrap.state, "ready");
    assert.equal(loginBody.clientType, truth.expected.clientType);
    assert.equal(loginBody.device.deviceHash, truth.deviceHash);
    assert.equal(bootstrapAuthorization, "Bearer access-token-1");
    const sessionRaw = fs.readFileSync(path.join(testRoot, "login", "desktop-user-session-v1.json"), "utf8");
    const bootstrapRaw = fs.readFileSync(path.join(testRoot, "login", "desktop-bootstrap-cache-v1.json"), "utf8");
    for (const token of ["access-token-1", "refresh-token-1", "protected:"]) {
      assert.equal(sessionRaw.includes(token), false);
      assert.equal(bootstrapRaw.includes(token), false);
    }
  });

  await check("platform model catalog is allowlisted and cached without enabling execution", async () => {
    const auth = client("platform-model-catalog", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, bootstrapResponse({
        modelCatalog: truth.platformModelCatalog,
        models: [truth.platformModel],
      }));
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, true);
    assert.equal(state.bootstrap.data.schemaVersion, 1);
    assert.deepEqual(state.bootstrap.data.modelCatalog, truth.platformModelCatalog);
    assert.equal(state.bootstrap.data.models.length, 1);
    assert.equal(state.bootstrap.data.models[0].source, "platform");
    assert.equal(state.bootstrap.data.models[0].provider.displayName, "灵帧平台");
    assert.equal(state.bootstrap.data.models[0].capabilityType, "video");
    assert.equal(state.bootstrap.data.models[0].executionReady, false);
    const cached = JSON.parse(fs.readFileSync(
      path.join(testRoot, "platform-model-catalog", "desktop-bootstrap-cache-v1.json"),
      "utf8",
    ));
    assert.equal(cached.userId, truth.user.id);
    assert.equal(cached.tenantId, truth.tenant.id);
    assert.deepEqual(cached.data.models, state.bootstrap.data.models);
    for (const field of truth.forbiddenPlatformModelFields) {
      assert.equal(JSON.stringify(cached).toLowerCase().includes(`\"${field.toLowerCase()}\"`), false);
    }
  });

  await check("sensitive platform model response is rejected and never cached", async () => {
    const auth = client("sensitive-platform-model", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, bootstrapResponse({
        modelCatalog: truth.platformModelCatalog,
        models: [{...truth.platformModel, baseUrl: "https://private.example.com/v1"}],
      }));
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
    assert.equal(fs.existsSync(
      path.join(testRoot, "sensitive-platform-model", "desktop-bootstrap-cache-v1.json"),
    ), false);
  });

  await check("sensitive skill metadata is rejected and never cached", async () => {
    const auth = client("sensitive-skill-metadata", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, {...bootstrapResponse(), skills: [{id: "skill-1", token: "private-token"}]});
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
    assert.equal(fs.existsSync(
      path.join(testRoot, "sensitive-skill-metadata", "desktop-bootstrap-cache-v1.json"),
    ), false);
  });

  await check("platform model response with execution enabled is rejected in wave three", async () => {
    const auth = client("premature-platform-execution", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, bootstrapResponse({
        modelCatalog: truth.platformModelCatalog,
        models: [{...truth.platformModel, executionReady: true}],
      }));
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
  });

  await check("available platform catalog without publication time is rejected", async () => {
    const auth = client("platform-catalog-without-published-at", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, bootstrapResponse({
        modelCatalog: {...truth.platformModelCatalog, publishedAt: null},
        models: [truth.platformModel],
      }));
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
  });

  await check("platform catalog over desktop model limit is rejected", async () => {
    const auth = client("platform-model-limit", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, bootstrapResponse({
        modelCatalog: truth.platformModelCatalog,
        models: Array.from({length: 501}, (_, index) => ({
          ...truth.platformModel,
          id: `model-${index}`,
        })),
      }));
    });
    const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
  });

  await check("deep or prototype-polluting platform schema is rejected", async () => {
    let schema = {type: "string"};
    for (let index = 0; index < 13; index += 1) schema = {[`level${index}`]: schema};
    const payloads = [
      schema,
      JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'),
    ];
    for (let index = 0; index < payloads.length; index += 1) {
      const auth = client(`unsafe-platform-schema-${index}`, async (url) => {
        if (url.endsWith("/auth/login")) return response(200, authResponse());
        return response(200, bootstrapResponse({
          modelCatalog: truth.platformModelCatalog,
          models: [{...truth.platformModel, parameterSchema: payloads[index]}],
        }));
      });
      const state = await auth.login({identity: truth.user.email, password: "StrongPassword!123"});
      assert.equal(state.workspaceReady, false);
      assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
    }
  });

  await check("saved session is restored then bootstrap is verified", async () => {
    const dataRoot = path.join(testRoot, "restore");
    const first = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login") ? authResponse() : bootstrapResponse()),
      device: {version: 1, hash: truth.deviceHash, suffix: "aaaaaaaaaa"},
    });
    await first.login({identity: truth.user.username, password: "StrongPassword!123"});
    const calls = [];
    const restored = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url, options) => {
        calls.push({url, authorization: options.headers.Authorization});
        if (url.endsWith("/auth/me")) return response(200, {
          userId: truth.user.id, username: truth.user.username, email: truth.user.email,
          tenantId: truth.tenant.id, tenantCode: truth.tenant.code, tenantName: truth.tenant.displayName,
          role: "owner", permissions: ["desktop.bootstrap", "creation.use"], featurePolicies: {},
        });
        return response(200, bootstrapResponse());
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "aaaaaaaaaa"},
    });
    const state = await restored.bootstrap();
    assert.equal(state.workspaceReady, true);
    assert.deepEqual(calls.map((item) => item.url), [`${truth.serverUrl}/api/v1/auth/me`, `${truth.serverUrl}/api/v1/desktop/bootstrap`]);
    assert.ok(calls.every((item) => item.authorization === "Bearer access-token-1"));
  });

  await check("multi tenant login initializes only selected tenant workspace", async () => {
    const calls = [];
    const auth = client("tenant", async (url, options) => {
      calls.push({url, body: options.body ? JSON.parse(options.body) : null});
      if (url.endsWith("/login")) return response(200, {
        status: "tenant_selection_required", tenantSelectionTicket: "ticket-1",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        tenants: [
          {tenantId: truth.tenant.id, tenantCode: truth.tenant.code, tenantName: truth.tenant.displayName, role: "owner"},
          {tenantId: truth.secondTenant.id, tenantCode: truth.secondTenant.code, tenantName: truth.secondTenant.displayName, role: "member"},
        ],
      });
      if (url.endsWith("/select-tenant")) return response(200, authResponse({tenant: truth.secondTenant}));
      return response(200, bootstrapResponse({tenant: truth.secondTenant}));
    });
    const pending = await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    assert.equal(pending.state, truth.expected.tenantSelectionState);
    assert.equal(pending.tenantSelection.tenants.length, 2);
    const selected = await auth.selectTenant(truth.secondTenant.id);
    assert.equal(selected.workspaceReady, true);
    assert.equal(selected.tenantId, truth.secondTenant.id);
    assert.equal(calls[1].body.tenantSelectionTicket, "ticket-1");
    assert.equal(calls[1].body.tenantId, truth.secondTenant.id);
  });

  await check("refresh rotation reloads bootstrap with the new access token", async () => {
    let refreshCount = 0;
    const bootstrapTokens = [];
    const auth = client("refresh", async (url, options) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      if (url.endsWith("/auth/refresh")) {
        refreshCount += 1;
        assert.equal(JSON.parse(options.body).refreshToken, "refresh-token-1");
        return response(200, authResponse({accessToken: "access-token-2", refreshToken: "refresh-token-2"}));
      }
      bootstrapTokens.push(options.headers.Authorization);
      return response(200, bootstrapResponse());
    });
    await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    const state = await auth.refresh();
    assert.equal(state.workspaceReady, true);
    assert.equal(refreshCount, 1);
    assert.deepEqual(bootstrapTokens, ["Bearer access-token-1", "Bearer access-token-2"]);
    const stored = JSON.parse(fs.readFileSync(path.join(testRoot, "refresh", "desktop-user-session-v1.json"), "utf8"));
    assert.equal(safeStorage.decryptString(Buffer.from(stored.refreshToken, "base64")), "refresh-token-2");
  });

  await check("expired access token refreshes before first bootstrap request", async () => {
    const now = Date.now();
    const calls = [];
    const auth = client("expired-access", async (url, options) => {
      calls.push(url);
      if (url.endsWith("/auth/login")) return response(200, authResponse({accessTokenExpiresAt: new Date(now + 5_000).toISOString()}));
      if (url.endsWith("/auth/refresh")) return response(200, authResponse({accessToken: "access-token-2", refreshToken: "refresh-token-2", accessTokenExpiresAt: new Date(now + 15 * 60_000).toISOString()}));
      assert.equal(options.headers.Authorization, "Bearer access-token-2");
      return response(200, bootstrapResponse());
    }, {now: () => now});
    const state = await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, true);
    assert.deepEqual(calls, [`${truth.serverUrl}/api/v1/auth/login`, `${truth.serverUrl}/api/v1/auth/refresh`, `${truth.serverUrl}/api/v1/desktop/bootstrap`]);
  });

  await check("bootstrap 401 refreshes token and retries exactly once", async () => {
    let bootstrapCount = 0;
    const auth = client("bootstrap-401", async (url, options) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      if (url.endsWith("/auth/refresh")) return response(200, authResponse({accessToken: "access-token-2", refreshToken: "refresh-token-2"}));
      bootstrapCount += 1;
      if (bootstrapCount === 1) {
        assert.equal(options.headers.Authorization, "Bearer access-token-1");
        return response(401, {code: "AUTHENTICATION_REQUIRED", message: "expired"});
      }
      assert.equal(options.headers.Authorization, "Bearer access-token-2");
      return response(200, bootstrapResponse());
    });
    const state = await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, true);
    assert.equal(bootstrapCount, 2);
  });

  await check("bootstrap permission denial blocks local workspace and tenant runtime", async () => {
    const auth = client("forbidden", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(403, {code: "DESKTOP_BOOTSTRAP_FORBIDDEN", message: "当前账号没有加载桌面工作台的权限"});
    });
    const state = await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    assert.equal(state.authenticated, true);
    assert.equal(state.workspaceReady, false);
    assert.equal(state.usable, false);
    assert.equal(state.state, "workspace_forbidden");
    assert.equal(state.tenantId, null);
    assert.equal(state.bootstrap.error.code, "DESKTOP_BOOTSTRAP_FORBIDDEN");
    assert.equal(fs.existsSync(path.join(testRoot, "forbidden", "desktop-bootstrap-cache-v1.json")), false);
    assert.throws(() => auth.assert("generate"), (error) => error.code === "AUTHENTICATION_REQUIRED");
  });

  await check("matching bootstrap cache enables offline workspace", async () => {
    const dataRoot = path.join(testRoot, "offline-cache");
    const online = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login")
        ? authResponse()
        : bootstrapResponse({
          modelCatalog: truth.platformModelCatalog,
          models: [truth.platformModel],
        })),
      device: {version: 1, hash: truth.deviceHash, suffix: "bbbbbbbbbb"},
    });
    await online.login({identity: truth.user.username, password: "StrongPassword!123"});
    const offline = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async () => { throw new Error("connect ECONNREFUSED"); },
      device: {version: 1, hash: truth.deviceHash, suffix: "bbbbbbbbbb"},
    });
    const state = await offline.bootstrap();
    assert.equal(state.authenticated, true);
    assert.equal(state.workspaceReady, true);
    assert.equal(state.usable, true);
    assert.equal(state.offline, true);
    assert.equal(state.state, "authenticated_offline");
    assert.equal(state.bootstrap.state, "offline_cache");
    assert.deepEqual(state.bootstrap.data.modelCatalog, truth.platformModelCatalog);
    assert.equal(state.bootstrap.data.models[0].id, truth.platformModel.id);
    assert.equal(state.bootstrap.data.models[0].executionReady, false);
  });

  await check("invalid online bootstrap cannot silently reuse an older cache", async () => {
    const dataRoot = path.join(testRoot, "invalid-online-does-not-fallback");
    const online = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login")
        ? authResponse()
        : bootstrapResponse({
          modelCatalog: truth.platformModelCatalog,
          models: [truth.platformModel],
        })),
      device: {version: 1, hash: truth.deviceHash, suffix: "eeeeeeeeee"},
    });
    await online.login({identity: truth.user.username, password: "StrongPassword!123"});
    const restored = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => {
        if (url.endsWith("/auth/me")) return response(200, {
          userId: truth.user.id, username: truth.user.username, email: truth.user.email,
          tenantId: truth.tenant.id, tenantCode: truth.tenant.code, tenantName: truth.tenant.displayName,
          role: "owner", permissions: ["desktop.bootstrap", "creation.use"], featurePolicies: {},
        });
        return response(200, bootstrapResponse({
          modelCatalog: truth.platformModelCatalog,
          models: [{...truth.platformModel, privateHeaders: {"X-Private": "secret"}}],
        }));
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "eeeeeeeeee"},
    });
    const state = await restored.bootstrap();
    assert.equal(state.workspaceReady, false);
    assert.equal(state.offline, false);
    assert.equal(state.state, "workspace_unavailable");
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("invalid online identity response cannot silently reuse an older cache", async () => {
    const dataRoot = path.join(testRoot, "invalid-me-does-not-fallback");
    const online = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login") ? authResponse() : bootstrapResponse()),
      device: {version: 1, hash: truth.deviceHash, suffix: "iiiiiiiiii"},
    });
    await online.login({identity: truth.user.username, password: "StrongPassword!123"});
    const restored = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => {
        if (url.endsWith("/auth/me")) return response(200, {
          userId: truth.user.id,
          username: truth.user.username,
          email: truth.user.email,
          tenantId: null,
          permissions: ["desktop.bootstrap", "creation.use"],
        });
        throw new Error("desktop bootstrap must not be requested");
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "iiiiiiiiii"},
    });
    const state = await restored.bootstrap();
    assert.equal(state.workspaceReady, false);
    assert.equal(state.offline, false);
    assert.equal(state.state, "workspace_unavailable");
    assert.equal(state.lastError.code, "INVALID_AUTH_RESPONSE");
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("tenant selection clears the previous authenticated workspace and cache", async () => {
    let loginCount = 0;
    const dataRoot = path.join(testRoot, "tenant-selection-clears-previous");
    const auth = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => {
        if (url.endsWith("/auth/login")) {
          loginCount += 1;
          if (loginCount === 1) return response(200, authResponse());
          return response(200, {
            status: "tenant_selection_required",
            tenantSelectionTicket: "ticket-switch",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            tenants: [
              {tenantId: truth.tenant.id, tenantCode: truth.tenant.code, tenantName: truth.tenant.displayName, role: "owner"},
              {tenantId: truth.secondTenant.id, tenantCode: truth.secondTenant.code, tenantName: truth.secondTenant.displayName, role: "member"},
            ],
          });
        }
        return response(200, bootstrapResponse({
          modelCatalog: truth.platformModelCatalog,
          models: [truth.platformModel],
        }));
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "ffffffffff"},
    });
    await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    const pending = await auth.login({identity: "another-user", password: "StrongPassword!123"});
    assert.equal(pending.state, "tenant_selection_required");
    assert.equal(pending.authenticated, false);
    assert.equal(pending.workspaceReady, false);
    assert.equal(pending.usable, false);
    assert.equal(pending.tenantId, null);
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-user-session-v1.json")), false);
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("obsolete bootstrap cache is rejected and removed", async () => {
    const dataRoot = path.join(testRoot, "obsolete-cache");
    const online = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login") ? authResponse() : bootstrapResponse()),
      device: {version: 1, hash: truth.deviceHash, suffix: "gggggggggg"},
    });
    await online.login({identity: truth.user.username, password: "StrongPassword!123"});
    const cacheFile = path.join(dataRoot, "desktop-bootstrap-cache-v1.json");
    const cache = JSON.parse(fs.readFileSync(cacheFile, "utf8"));
    fs.writeFileSync(cacheFile, JSON.stringify({...cache, version: 0}, null, 2), "utf8");
    const offline = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async () => { throw new Error("connect ECONNREFUSED"); },
      device: {version: 1, hash: truth.deviceHash, suffix: "gggggggggg"},
    });
    const state = await offline.bootstrap();
    assert.equal(state.workspaceReady, false);
    assert.equal(state.state, "workspace_unavailable");
    assert.equal(fs.existsSync(cacheFile), false);
  });

  await check("different tenant cannot reuse an existing bootstrap cache", async () => {
    const dataRoot = path.join(testRoot, "tenant-isolation");
    const first = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login") ? authResponse() : bootstrapResponse()),
      device: {version: 1, hash: truth.deviceHash, suffix: "cccccccccc"},
    });
    await first.login({identity: truth.user.username, password: "StrongPassword!123"});
    const switched = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => {
        if (url.endsWith("/auth/login")) return response(200, authResponse({tenant: truth.secondTenant}));
        throw new Error("connect ECONNREFUSED");
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "cccccccccc"},
    });
    const state = await switched.login({identity: truth.user.username, password: "StrongPassword!123"});
    assert.equal(state.authenticated, true);
    assert.equal(state.workspaceReady, false);
    assert.equal(state.state, "workspace_unavailable");
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("server-side tenant change clears the previous bootstrap cache", async () => {
    const dataRoot = path.join(testRoot, "server-tenant-change");
    const first = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login") ? authResponse() : bootstrapResponse()),
      device: {version: 1, hash: truth.deviceHash, suffix: "hhhhhhhhhh"},
    });
    await first.login({identity: truth.user.username, password: "StrongPassword!123"});
    const restored = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => {
        if (url.endsWith("/auth/me")) return response(200, {
          userId: truth.user.id, username: truth.user.username, email: truth.user.email,
          tenantId: truth.secondTenant.id, tenantCode: truth.secondTenant.code,
          tenantName: truth.secondTenant.displayName, role: "member",
          permissions: ["desktop.bootstrap", "creation.use"], featurePolicies: {},
        });
        throw new Error("connect ECONNREFUSED");
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "hhhhhhhhhh"},
    });
    const state = await restored.bootstrap();
    assert.equal(state.authenticated, true);
    assert.equal(state.tenant.id, truth.secondTenant.id);
    assert.equal(state.workspaceReady, false);
    assert.equal(state.state, "workspace_unavailable");
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("different user cannot reuse an existing bootstrap cache", async () => {
    const dataRoot = path.join(testRoot, "user-isolation");
    const first = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => response(200, url.endsWith("/auth/login") ? authResponse() : bootstrapResponse()),
      device: {version: 1, hash: truth.deviceHash, suffix: "dddddddddd"},
    });
    await first.login({identity: truth.user.username, password: "StrongPassword!123"});
    const otherUser = {...truth.user, id: "99999999-9999-4999-8999-999999999999"};
    const switched = new DesktopAuthClient({
      dataRoot, appVersion: "0.12.5", safeStorage, serverUrl: truth.serverUrl,
      fetchFn: async (url) => {
        if (url.endsWith("/auth/login")) return response(200, authResponse({user: otherUser}));
        throw new Error("connect ECONNREFUSED");
      },
      device: {version: 1, hash: truth.deviceHash, suffix: "dddddddddd"},
    });
    const state = await switched.login({identity: otherUser.email, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(fs.existsSync(path.join(dataRoot, "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("invalid bootstrap response is never cached", async () => {
    const auth = client("invalid-bootstrap", async (url) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      return response(200, {...bootstrapResponse(), skills: null});
    });
    const state = await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    assert.equal(state.workspaceReady, false);
    assert.equal(state.bootstrap.error.code, "INVALID_DESKTOP_BOOTSTRAP_RESPONSE");
    assert.equal(fs.existsSync(path.join(testRoot, "invalid-bootstrap", "desktop-bootstrap-cache-v1.json")), false);
  });

  await check("invalid credentials preserve server error code", async () => {
    const auth = client("wrong-password", async () => response(401, {code: truth.expected.wrongPasswordCode, message: "账号或密码不正确"}));
    await assert.rejects(() => auth.login({identity: truth.user.username, password: "wrong"}), (error) => error.code === truth.expected.wrongPasswordCode && error.status === 401);
    assert.equal(auth.status().authenticated, false);
  });

  await check("unavailable service returns a finite actionable login error", async () => {
    const auth = client("unavailable", async () => { const error = new Error("connect ECONNREFUSED"); error.code = "ECONNREFUSED"; throw error; });
    await assert.rejects(() => auth.login({identity: truth.user.username, password: "StrongPassword!123"}), (error) => error.code === truth.expected.unavailableCode && /暂时不可用/.test(error.message));
  });

  await check("logout revokes remotely and clears session plus bootstrap cache", async () => {
    let logoutAuthorization = "";
    const auth = client("logout", async (url, options) => {
      if (url.endsWith("/auth/login")) return response(200, authResponse());
      if (url.endsWith("/desktop/bootstrap")) return response(200, bootstrapResponse());
      logoutAuthorization = options.headers.Authorization;
      return response(204, {});
    });
    await auth.login({identity: truth.user.username, password: "StrongPassword!123"});
    const state = await auth.logout();
    assert.equal(logoutAuthorization, "Bearer access-token-1");
    assert.equal(state.authenticated, false);
    assert.equal(fs.existsSync(path.join(testRoot, "logout", "desktop-user-session-v1.json")), false);
    assert.equal(fs.existsSync(path.join(testRoot, "logout", "desktop-bootstrap-cache-v1.json")), false);
  });

  const uiSource = fs.readFileSync(path.join(root, "src", "renderer", "auth-ui.js"), "utf8");
  const cssSource = fs.readFileSync(path.join(root, "src", "renderer", "styles", "auth.css"), "utf8");
  const preloadSource = fs.readFileSync(path.join(root, "src", "preload", "preload.cjs"), "utf8");
  const mainSource = fs.readFileSync(path.join(root, "src", "main", "main.cjs"), "utf8");
  await check("desktop UI and IPC expose workspace initialization states", async () => {
    for (const token of ["欢迎回来", "创建灵帧AI账号", "tenant_selection_required", "正在初始化工作台", "工作台初始化失败", "data-bootstrap-retry", "data-bootstrap-logout", "workspaceReady"]) assert.ok(uiSource.includes(token), `missing ${token}`);
    assert.ok(cssSource.includes(".auth-workspace-error"));
    assert.ok(cssSource.includes("@media(max-width:920px)"));
    assert.ok(cssSource.includes("prefers-reduced-motion"));
    assert.ok(preloadSource.includes("auth:desktop-bootstrap"));
    assert.ok(mainSource.includes("ipcMain.handle('auth:desktop-bootstrap'"));
    assert.ok(mainSource.includes("TenantRuntimeLifecycle"));
    assert.ok(mainSource.includes("refreshTenantRuntime(status)"));
    assert.ok(mainSource.includes("desktopIdentity.runtimeTenantId()"));
  });

  await check("local model gateway bootstrap remains isolated from platform catalog cache", async () => {
    assert.ok(mainSource.includes(
      "ipcMain.handle('models:bootstrap',()=>desktopIdentity.tenantId()?modelGateway.bootstrap():[]);",
    ));
    assert.equal(mainSource.includes("bootstrap.data.models"), false);
    assert.equal(mainSource.includes("workspace.models"), false);
  });

  await check("desktop auth UI follows the coordinated visual system", async () => {
    for (const token of ["auth-card-shell", "auth-card-kicker", "auth-submit-mark", "auth-loading-mark", "setSubmitState"]) assert.ok(uiSource.includes(token) || cssSource.includes(token), `missing visual token ${token}`);
    assert.ok(cssSource.includes("--auth-motion:cubic-bezier"));
    assert.ok(cssSource.includes("font-family:\"Segoe UI Variable Text\""));
    assert.ok(cssSource.includes(".auth-input-wrap:focus-within"));
    assert.ok(cssSource.includes(".auth-submit:focus-visible"));
    assert.ok(!uiSource.includes("—"));
    assert.ok(!uiSource.includes("–"));
    assert.ok(!cssSource.includes("linear infinite"));
    assert.ok(!cssSource.includes("#765ce7"));
  });

  const failed = results.filter((item) => !item.passed);
  const report = {test: "desktop-auth", passed: results.length - failed.length, failed: failed.length, results, testRoot};
  fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
  fs.writeFileSync(path.join(root, "scripts", "log", "desktop-auth.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exitCode = 1; });
