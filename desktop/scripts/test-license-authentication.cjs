"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {LicenseClient, APP_ID} = require("../src/main/license-client.cjs");
const {LicenseGuard} = require("../src/main/license-guard.cjs");

const referenceFile = path.join(__dirname, "../references/license-authentication-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(referenceFile, "utf8"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-license-auth-"));
const device = {version: 1, hash: "a".repeat(64), suffix: "aaaaaaaaaa"};
const tenantId = "65e99651-60a0-46ee-a240-8e416372ff55";
const {publicKey, privateKey} = crypto.generateKeyPairSync("ed25519");
const checks = [];

function signGrant({deviceHash = device.hash, licenseExpiresIn = 30 * 24 * 60 * 60_000, leaseExpiresIn = 60 * 60_000} = {}) {
  const now = Date.now();
  const payload = {
    version: 1,
    issuer: "dola-license-center",
    appId: APP_ID,
    deviceHash,
    tenantId,
    licenseId: "license-auth-test",
    keyPrefix: "DOLA-ABCD",
    serverTime: new Date(now).toISOString(),
    refreshAfter: new Date(now + Math.min(30_000, Math.max(1_000, leaseExpiresIn - 1_000))).toISOString(),
    leaseExpiresAt: new Date(now + leaseExpiresIn).toISOString(),
    licenseExpiresAt: new Date(now + licenseExpiresIn).toISOString()
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  return {
    payload: bytes.toString("base64url"),
    signature: crypto.sign(null, bytes, privateKey).toString("base64url")
  };
}

function createClient(name, requestFn, serverUrls = ["https://license-a.test", "https://license-b.test"]) {
  return new LicenseClient({
    dataRoot: path.join(root, name),
    serverUrls,
    device,
    publicKey,
    requestFn
  });
}

async function check(name, operation) {
  try {
    await operation();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error && error.stack || error)});
  }
}

(async () => {
  await check("无效密钥格式在联网前被拒绝", async () => {
    let calls = 0;
    const client = createClient("invalid-format", async () => { calls += 1; return {}; });
    await assert.rejects(() => client.activate("bad-key"), error => error.code === truth.expected.invalidFormatCode);
    assert.equal(calls, 0);
  });

  await check("有效密钥会标准化并保存签名授权", async () => {
    let request = null;
    const client = createClient("active", async (serverUrl, pathname, body) => {
      request = {serverUrl, pathname, body};
      return {activationToken: "token-active", grant: signGrant()};
    });
    const status = await client.activate(truth.validKey.toLowerCase());
    assert.equal(request.pathname, "/api/v1/activate");
    assert.equal(request.body.key, truth.validKey);
    assert.equal(request.body.deviceHash, device.hash);
    assert.equal(status.state, truth.expected.activeState);
    assert.equal(status.usable, true);
    assert.equal(fs.existsSync(client.file), truth.expected.bindingPersists);
    const reloaded = createClient("active", async () => ({}));
    assert.equal(reloaded.status().usable, true);
    assert.equal(reloaded.status().tenantId, tenantId);
  });

  await check("篡改签名不能激活且不落盘", async () => {
    const bad = signGrant();
    bad.signature = Buffer.from("tampered").toString("base64url");
    const client = createClient("bad-signature", async () => ({activationToken: "token", grant: bad}), ["https://license-only.test"]);
    await assert.rejects(() => client.activate(truth.validKey), error => error.code === truth.expected.invalidSignatureCode);
    assert.equal(fs.existsSync(client.file), false);
  });

  await check("其他设备的签名授权不能激活", async () => {
    const client = createClient("wrong-device", async () => ({activationToken: "token", grant: signGrant({deviceHash: "c".repeat(64)})}), ["https://license-only.test"]);
    await assert.rejects(() => client.activate(truth.validKey), error => error.code === truth.expected.invalidSignatureCode);
  });

  await check("主授权服务 5xx 时允许切换备用地址", async () => {
    const calls = [];
    const client = createClient("fallback", async serverUrl => {
      calls.push(serverUrl);
      if (calls.length === 1) throw Object.assign(new Error("temporary unavailable"), {status: 503});
      return {activationToken: "token-fallback", grant: signGrant()};
    });
    const status = await client.activate(truth.validKey);
    assert.equal(status.usable, true);
    assert.deepEqual(calls, ["https://license-a.test", "https://license-b.test"]);
    assert.equal(client.serverUrl, "https://license-b.test");
  });

  await check("授权服务 4xx 拒绝后不会把密钥继续发送到备用地址", async () => {
    const calls = [];
    const client = createClient("client-reject", async serverUrl => {
      calls.push(serverUrl);
      throw Object.assign(new Error("key rejected"), {status: 403, code: "LICENSE_REJECTED"});
    });
    await assert.rejects(() => client.activate(truth.validKey), error => error.code === "LICENSE_REJECTED");
    assert.equal(calls.length, truth.expected.clientErrorStopsFallback ? 1 : 2);
  });

  await check("已过期签名密钥激活后保持禁用", async () => {
    const client = createClient("expired", async () => ({activationToken: "token-expired", grant: signGrant({licenseExpiresIn: -1_000})}), ["https://license-only.test"]);
    const status = await client.activate(truth.validKey);
    assert.equal(status.state, truth.expected.expiredState);
    assert.equal(status.usable, false);
  });

  await check("联网复核可更新有效授权", async () => {
    let phase = "activate";
    const client = createClient("refresh", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/activate") return {activationToken: "token-refresh", grant: signGrant({leaseExpiresIn: 10_000})};
      phase = "verify";
      return {grant: signGrant({leaseExpiresIn: 60_000})};
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    const status = await client.refresh();
    assert.equal(phase, "verify");
    assert.equal(status.usable, true);
    assert.equal(client.lastNetworkError, null);
  });

  await check("服务端撤销密钥后应立即进入 revoked 并禁用", async () => {
    const client = createClient("revoked", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/activate") return {activationToken: "token-revoked", grant: signGrant()};
      throw Object.assign(new Error("license revoked"), {status: 403, code: truth.expected.revokedErrorCode});
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    await assert.rejects(() => client.refresh(), error => error.code === truth.expected.revokedErrorCode);
    const status = client.status();
    assert.equal(status.state, truth.expected.revokedState);
    assert.equal(status.usable, false);
    const reloaded = createClient("revoked", async () => ({}), ["https://license-only.test"]);
    assert.equal(reloaded.status().state, truth.expected.revokedState);
    assert.equal(reloaded.status().tenantId, tenantId);
  });

  await check("授权守卫在撤销响应后立即发布 restricted 状态", async () => {
    const client = createClient("revoked-guard", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/activate") return {activationToken: "token-revoked-guard", grant: signGrant()};
      throw Object.assign(new Error("license revoked"), {status: 403, code: truth.expected.revokedErrorCode});
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    const guard = new LicenseGuard({licenseClient: client, refreshFn: () => client.refresh()});
    let changed = null;
    guard.on("change", status => { changed = status; });
    const status = await guard.refresh();
    assert.equal(status.state, truth.expected.revokedState);
    assert.equal(status.mode, "restricted");
    assert.equal(status.usable, false);
    assert.equal(changed?.state, truth.expected.revokedState);
    assert.equal(guard.can("generate", status), false);
    assert.equal(guard.can("result-recovery", status), true);
    assert.throws(() => guard.assert("generate"), error => error.code === truth.expected.revokedErrorCode && error.licenseState === truth.expected.revokedState);
    assert.equal(guard.lastRefreshError?.code, truth.expected.revokedErrorCode);
  });

  await check("普通 403 拒绝进入 verification_required", async () => {
    const client = createClient("verification-required", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/activate") return {activationToken: "token-verification", grant: signGrant()};
      throw Object.assign(new Error("verification required"), {status: 403, code: "LICENSE_SERVER_REJECTED"});
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    await assert.rejects(() => client.refresh());
    assert.equal(client.status().state, "verification_required");
    assert.equal(client.status().usable, false);
  });

  await check("授权中心 5xx 不会误锁仍在离线宽限内的授权", async () => {
    const client = createClient("network-error", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/activate") return {activationToken: "token-network", grant: signGrant()};
      throw Object.assign(new Error("temporary unavailable"), {status: 503, code: "SERVICE_UNAVAILABLE"});
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    await assert.rejects(() => client.refresh(), error => error.status === 503);
    assert.equal(client.status().state, truth.expected.activeState);
    assert.equal(client.status().usable, true);
    assert.equal(client.state.restriction, undefined);
  });

  await check("重新激活成功后清除旧限制状态", async () => {
    let phase = "activate";
    const client = createClient("reactivate", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/verify") throw Object.assign(new Error("license revoked"), {status: 403, code: truth.expected.revokedErrorCode});
      phase = "activate";
      return {activationToken: "token-reactivated", grant: signGrant()};
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    await assert.rejects(() => client.refresh());
    assert.equal(client.status().state, truth.expected.revokedState);
    await client.activate(truth.validKey);
    assert.equal(phase, "activate");
    assert.equal(client.status().state, truth.expected.activeState);
    assert.equal(client.state.restriction, undefined);
  });

  await check("用户不点击复核时后台定时检查仍会自动锁定撤销密钥", async () => {
    const client = createClient("automatic-revocation", async (_serverUrl, pathname) => {
      if (pathname === "/api/v1/activate") return {activationToken: "token-automatic", grant: signGrant()};
      throw Object.assign(new Error("license revoked"), {status: 403, code: truth.expected.revokedErrorCode});
    }, ["https://license-only.test"]);
    await client.activate(truth.validKey);
    const guard = new LicenseGuard({licenseClient: client, refreshFn: () => client.refresh(), localCheckMs: 1_000, networkMinMs: 1_000, networkCheckMs: 1_000});
    let changed = null;
    guard.on("change", status => { if (status.state === truth.expected.revokedState) changed = status; });
    guard.start();
    await new Promise(resolve => setTimeout(resolve, 1_250));
    assert.equal(guard.last.state, truth.expected.revokedState);
    assert.equal(guard.last.usable, false);
    assert.equal(changed?.state, truth.expected.revokedState);
    guard.stop();
  });

  await check("桌面后台复核会先更新服务线路再校验密钥", async () => {
    const mainSource = fs.readFileSync(path.join(__dirname, "../src/main/main.cjs"), "utf8");
    assert.ok(mainSource.includes("refreshFn:refreshLicenseAuthority"));
    assert.ok(mainSource.includes("await connectionConfig.refresh().catch(()=>{});syncConnectionEndpoints();return licenseClient.refresh()"));
  });

  await check("授权失效先显示提醒弹窗并由用户决定是否进入密钥页", async () => {
    const source = fs.readFileSync(path.join(__dirname, "../src/renderer/desktop-ui.js"), "utf8");
    assert.ok(source.includes("稍后处理（只读）"));
    assert.ok(source.includes("data-license-notice-action=\"activate\""));
    assert.ok(source.includes("gate(status, identity, {force:true})"));
    assert.ok(source.includes("返回只读模式"));
  });

  const failures = checks.filter(item => !item.ok);
  const result = {
    test: "license-authentication",
    timestamp: new Date().toISOString(),
    referenceFile,
    total: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
    checks,
    root
  };
  const logDir = path.join(__dirname, "log");
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, "license-authentication.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exit(1);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
