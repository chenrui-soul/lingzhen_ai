"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const {DOUBAO_LOGIN_PROBE_EXPRESSION, classifyDoubaoLoginState, hasDecisivePageLoginSignal} = require("../src/main/doubao-login-state.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const loginTruth = JSON.parse(fs.readFileSync(path.join(root, "references", "doubao-login-state-ground-truth.json"), "utf8"));
const checks = [];
const check = async (name, operation) => {
  try { await operation(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.stack || error)}); }
};

function makeStore(initialTasks = []) {
  const taskList = initialTasks.map(task => ({...task}));
  return {
    taskList,
    bootstrap: () => ({tasks: taskList, assets: []}),
    reportTask: (taskId, patch) => {
      const task = taskList.find(item => item.id === taskId);
      if (!task) throw new Error(`测试任务不存在：${taskId}`);
      Object.assign(task, patch);
      return {...task};
    },
    doubaoQuotaBlock: () => null,
  };
}

function task(id, selectionMode = "auto") {
  const accounts = [{id: "account-a", name: "账号 A"}, {id: "account-b", name: "账号 B"}];
  return {
    id,
    title: id,
    prompt: `提示词 ${id}`,
    projectId: "project-login-routing",
    creationType: "video",
    executionChannel: "doubao",
    state: "queued",
    accountSelectionMode: selectionMode,
    accountId: accounts[0].id,
    accountName: accounts[0].name,
    accountCandidates: selectionMode === "auto" ? accounts : [accounts[0]],
    doubaoModel: "Seedance 2.0 Mini",
    ratio: "16:9",
    duration: "10s",
    assetIds: [],
    referenceAssets: [],
  };
}

function makeOrchestrator(store, states, calls = []) {
  const runtime = {
    detect: async account => ({accountId: account.id, ...(states[account.id] || states.default || {state: "unknown", loggedIn: false})}),
    beginTask: async () => {},
    updateTask: () => {},
  };
  const orchestrator = new GenerationOrchestrator({
    tenantIdProvider: () => "tenant-login-routing",
    tasks: store,
    modelGateway: {},
    agentBridge: {browser: {
      embeddedBrowserProvider: () => runtime,
      execute: async command => {
        calls.push({accountId: command.account.id, action: command.action});
        return {ok: true, generating: true, state: "generating", conversationId: `conversation-${command.account.id}`, submittedVerified: true, submittedEvidence: {prompt: command.payload.prompt, conversationId: `conversation-${command.account.id}`}, message: "正在生成"};
      },
    }},
    dataRootProvider: () => root,
  });
  return orchestrator;
}

function runAnonymousPageProbe(fixture) {
  const element = ({text = "", src = "", className = "", tagName = "BUTTON"} = {}) => ({
    tagName,
    innerText: text,
    textContent: text,
    currentSrc: src,
    src,
    className,
    getBoundingClientRect: () => ({width: 72, height: 36}),
    getAttribute: name => name === "class" ? className : "",
    closest: () => null,
  });
  const loginButton = element({text: fixture.loginEntryText});
  const document = {
    readyState: "complete",
    body: {innerText: fixture.bodyText},
    querySelectorAll: selector => selector === 'button,a,[role="button"]' ? [loginButton] : [],
  };
  return vm.runInNewContext(DOUBAO_LOGIN_PROBE_EXPRESSION, {
    document,
    location: {hostname: "www.doubao.com", href: fixture.url},
    getComputedStyle: () => ({display: "block", visibility: "visible", opacity: "1"}),
  });
}

(async () => {
  await check("退出登录匿名首页探针可执行并识别登录入口", () => {
    const probe = runAnonymousPageProbe(loginTruth.anonymousPage);
    assert.equal(probe.loginEntry, true);
    const result = classifyDoubaoLoginState(probe, [{name: "sessionid", value: "stale-cookie"}]);
    assert.equal(result.state, loginTruth.anonymousPage.expectedState);
    assert.equal(result.loggedIn, false);
  });

  await check("页面尚未出现登录或头像时不得用残留 Cookie 提前结束检测", () => {
    assert.equal(hasDecisivePageLoginSignal({onPlatform:true, readyState:"complete", bodyTextLength:80}), false);
    assert.equal(hasDecisivePageLoginSignal({onPlatform:true, loginEntry:true}), true);
    assert.equal(hasDecisivePageLoginSignal({onPlatform:true, avatarFound:true}), true);
  });

  for (const fixture of loginTruth.classificationCases) {
    await check(`登录状态 Ground Truth：${fixture.id}`, () => {
      const result = classifyDoubaoLoginState(fixture.probe, fixture.cookies);
      assert.equal(result.state, fixture.expectedState);
      assert.equal(result.loggedIn, fixture.expectedState === "logged_in");
    });
  }

  await check("统一登录判定优先识别人工验证", () => {
    const result = classifyDoubaoLoginState({onPlatform: true, readyState: "complete", bodyTextLength: 500, verificationRequired: true, avatarFound: true}, [{name: "sessionid", value: "valid"}]);
    assert.equal(result.state, "verification_required");
    assert.equal(result.loggedIn, false);
  });

  await check("统一登录判定接受强页面身份信号", () => {
    const result = classifyDoubaoLoginState({onPlatform: true, readyState: "complete", bodyTextLength: 500, verificationRequired: false, loginEntry: false, avatarFound: true}, []);
    assert.equal(result.state, "logged_in");
    assert.equal(result.loggedIn, true);
  });

  await check("自动调度跳过未登录账号并使用已登录账号", async () => {
    const current = task("auto-skip-logged-out");
    const store = makeStore([current]);
    const calls = [];
    const orchestrator = makeOrchestrator(store, {
      "account-a": {state: "logged_out", loggedIn: false},
      "account-b": {state: "logged_in", loggedIn: true},
    }, calls);
    await orchestrator.run(current.id);
    const saved = store.taskList[0];
    assert.equal(saved.accountId, "account-b");
    assert.deepStrictEqual(calls, [{accountId: "account-b", action: "generate"}]);
    orchestrator.clearMonitor(current.id);
    orchestrator.releaseAccount(current.id);
    orchestrator.dispose();
  });

  await check("全部候选账号未登录时任务等待人工登录且不提交", async () => {
    const current = task("all-logged-out");
    const store = makeStore([current]);
    const calls = [];
    const orchestrator = makeOrchestrator(store, {default: {state: "logged_out", loggedIn: false}}, calls);
    const result = await orchestrator.run(current.id);
    assert.equal(result.state, "awaiting_login");
    assert.equal(calls.length, 0);
    assert.match(result.statusText, /登录/);
    orchestrator.releaseAccount(current.id);
    orchestrator.dispose();
  });

  await check("指定账号需要验证时任务等待人工验证且不提交", async () => {
    const current = task("manual-verification", "manual");
    const store = makeStore([current]);
    const calls = [];
    const orchestrator = makeOrchestrator(store, {default: {state: "verification_required", verificationRequired: true, loggedIn: false}}, calls);
    const result = await orchestrator.run(current.id);
    assert.equal(result.state, "awaiting_verification");
    assert.equal(calls.length, 0);
    orchestrator.releaseAccount(current.id);
    orchestrator.dispose();
  });

  await check("重新登录后继续原任务且不走 generate 重提", async () => {
    const current = {...task("resume-after-login", "manual"), state: "awaiting_login", conversationId: "conversation-existing", evidence: {conversationId: "conversation-existing", submittedAt: new Date().toISOString()}};
    const store = makeStore([current]);
    const calls = [];
    const orchestrator = makeOrchestrator(store, {default: {state: "logged_in", loggedIn: true}}, calls);
    await orchestrator.resume(current.id);
    assert.deepStrictEqual(calls, [{accountId: "account-a", action: "resume"}]);
    orchestrator.clearMonitor(current.id);
    orchestrator.releaseAccount(current.id);
    orchestrator.dispose();
  });

  await check("提交前等待登录的任务在登录后只首次提交一次", async () => {
    const current = {...task("pre-submit-resume", "manual"), state: "awaiting_login", recoveryState: "pre_submit_login_required", submittedVerified: false, evidence: null};
    const store = makeStore([current]);
    const calls = [];
    const orchestrator = makeOrchestrator(store, {default: {state: "logged_in", loggedIn: true}}, calls);
    await orchestrator.resume(current.id);
    assert.deepStrictEqual(calls, [{accountId: "account-a", action: "generate"}]);
    orchestrator.clearMonitor(current.id);
    orchestrator.releaseAccount(current.id);
    orchestrator.dispose();
  });

  await check("账号中心不再展示静态登录统计和静态账号登录文案", () => {
    const app = fs.readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
    const ui = fs.readFileSync(path.join(root, "src", "renderer", "desktop-ui.js"), "utf8");
    assert(!app.includes("豆包账号　白同学 · 已登录"));
    assert(app.includes("data-doubao-account-total"));
    assert(app.includes("data-status-doubao"));
    assert(ui.includes("applyAccountLoginState"));
    assert(ui.includes("refreshDoubaoMetrics"));
  });

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-login-routing", timestamp: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
  fs.writeFileSync(path.join(root, "scripts", "log", "doubao-login-routing.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
