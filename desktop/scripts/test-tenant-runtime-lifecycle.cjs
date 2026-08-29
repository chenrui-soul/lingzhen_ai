"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {TenantRuntimeLifecycle, runtimeIdentity} = require("../src/main/tenant-runtime-lifecycle.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "tenant-runtime-lifecycle-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const checks = [];

function check(name, fn) {
  try { fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.stack || error)}); }
}

function authenticated(userId, tenantId, {ready = true, bootstrapState = ready ? "ready" : "loading"} = {}) {
  return {
    authenticated:true,
    workspaceReady:ready,
    user:{id:userId},
    tenant:{id:tenantId},
    bootstrap:{state:bootstrapState},
  };
}

function unauthenticated() {
  return {authenticated:false, workspaceReady:false, user:null, tenant:null, bootstrap:{state:"unavailable"}};
}

function harness({running = false, scope = ""} = {}) {
  const calls = {create:0, dispose:0, recover:0, refresh:0};
  let hasRuntime = running;
  const lifecycle = new TenantRuntimeLifecycle({
    hasRuntime:()=>hasRuntime,
    createRuntime:()=>{calls.create += 1; calls.recover += 1; hasRuntime = true;},
    disposeRuntime:()=>{calls.dispose += 1; hasRuntime = false;},
    refreshRuntime:()=>{calls.refresh += 1;},
  });
  lifecycle.scope = scope;
  return {lifecycle, calls, isRunning:()=>hasRuntime};
}

check("loading 状态仍保留已认证的运行时身份", () => {
  assert.deepStrictEqual(runtimeIdentity(authenticated("user-a", "tenant-a", {ready:false})), {
    userId:"user-a", tenantId:"tenant-a", scope:"user-a:tenant-a", workspaceReady:false,
  });
});

check("同用户同租户 Access Token 轮换不销毁或恢复任务", () => {
  const {lifecycle, calls, isRunning} = harness({running:true, scope:"user-a:tenant-a"});
  const result = lifecycle.sync(authenticated("user-a", "tenant-a"));
  assert.equal(result.action, "reused");
  assert.equal(isRunning(), true);
  assert.deepStrictEqual({create:calls.create, dispose:calls.dispose, recover:calls.recover}, truth.expected.sameScopeRefresh);
});

check("同 scope Bootstrap loading 到 ready 多次事件保持同一运行时", () => {
  const {lifecycle, calls, isRunning} = harness({running:true, scope:"user-a:tenant-a"});
  assert.equal(lifecycle.sync(authenticated("user-a", "tenant-a", {ready:false})).action, "reused");
  assert.equal(lifecycle.sync(authenticated("user-a", "tenant-a", {ready:true})).action, "reused");
  assert.equal(lifecycle.sync(authenticated("user-a", "tenant-a", {ready:true})).action, "reused");
  assert.equal(isRunning(), true);
  assert.deepStrictEqual({create:calls.create, dispose:calls.dispose, recover:calls.recover}, truth.expected.sameScopeBootstrap);
});

check("IPC refresh 后 change 事件重复触发仍然幂等", () => {
  const {lifecycle, calls} = harness({running:true, scope:"user-a:tenant-a"});
  lifecycle.sync(authenticated("user-a", "tenant-a"));
  lifecycle.sync(authenticated("user-a", "tenant-a"));
  assert.equal(calls.create, 0);
  assert.equal(calls.dispose, 0);
  assert.equal(calls.recover, 0);
  assert.equal(calls.refresh, 2);
});

for (const [name, next] of [
  ["userId 变化", authenticated("user-b", "tenant-a")],
  ["tenantId 变化", authenticated("user-a", "tenant-b")],
]) {
  check(`${name}时销毁旧运行时并为新 scope 执行一次恢复`, () => {
    const {lifecycle, calls, isRunning} = harness({running:true, scope:"user-a:tenant-a"});
    assert.equal(lifecycle.sync(next).action, "created");
    assert.equal(isRunning(), true);
    assert.deepStrictEqual({create:calls.create, dispose:calls.dispose, recover:calls.recover}, truth.expected.scopeSwitch);
  });
}

check("应用冷启动创建运行时并执行一次崩溃恢复", () => {
  const {lifecycle, calls, isRunning} = harness();
  assert.equal(lifecycle.sync(authenticated("user-a", "tenant-a")).action, "created");
  assert.equal(isRunning(), true);
  assert.deepStrictEqual({create:calls.create, dispose:calls.dispose, recover:calls.recover}, truth.expected.coldStart);
});

check("冷启动 Bootstrap 尚在 loading 时等待 ready，不提前恢复任务", () => {
  const {lifecycle, calls, isRunning} = harness();
  assert.equal(lifecycle.sync(authenticated("user-a", "tenant-a", {ready:false})).action, "waiting");
  assert.equal(isRunning(), false);
  assert.deepStrictEqual({create:calls.create, dispose:calls.dispose, recover:calls.recover}, truth.expected.sameScopeBootstrap);
  assert.equal(lifecycle.sync(authenticated("user-a", "tenant-a")).action, "created");
  assert.equal(calls.recover, 1);
});

check("退出登录销毁运行时并清空 scope", () => {
  const {lifecycle, calls, isRunning} = harness({running:true, scope:"user-a:tenant-a"});
  assert.equal(lifecycle.sync(unauthenticated()).action, "disposed");
  assert.equal(isRunning(), false);
  assert.equal(lifecycle.scope, "");
  assert.deepStrictEqual({create:calls.create, dispose:calls.dispose, recover:calls.recover}, truth.expected.logout);
});

const failures = checks.filter(item => !item.ok);
const report = {
  test:truth.test,
  generatedAt:new Date().toISOString(),
  groundTruth:truthPath,
  total:checks.length,
  passed:checks.length-failures.length,
  failed:failures.length,
  checks,
};
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive:true});
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const logPath = path.join(logDir, `tenant-runtime-lifecycle-${stamp}.json`);
fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");
fs.writeFileSync(path.join(logDir, "tenant-runtime-lifecycle.json"), JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify({...report, logPath}, null, 2));
if (failures.length) process.exitCode = 1;
