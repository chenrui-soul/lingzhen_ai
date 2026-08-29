"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "doubao-intermediate-recovery-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
fs.writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`, "utf8");
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-doubao-intermediate-"));
const tenantRoot = path.join(tempRoot, truth.tenantId);
const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
const projectId = bridge.bootstrap().currentProjectId;
const checks = [];

const check = async (name, fn) => { try { await fn(); checks.push({name, ok: true}); } catch (error) { checks.push({name, ok: false, error: String(error.stack || error)}); } };
const make = (state, suffix, patch = {}) => bridge.createTask({projectId, title: `${state}-${suffix}`, prompt: `测试 ${state}`, executionChannel: "doubao", state, accountId: `account-${suffix}`, accountName: `账号-${suffix}`, doubaoModel: "Seedance 2.0 Mini", ratio: "16:9", duration: "10s", ...patch});

for (const state of truth.safeRestartStates) make(state, `safe-${state}`);
for (const state of truth.protectedRestartStates) make(state, `protected-${state}`);
const irreversiblePreparing = make("preparing", "irreversible", {executionAttemptId: "attempt-irreversible", executionCheckpoint: {phase: "browser_automation_started", action: "configure_and_submit", irreversible: true, startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), submissionStartedAt: new Date().toISOString()}});
const recoverableGenerating = make("generating", "generating-evidence", {conversationId: "conversation-recovery"});
bridge.reportTask(recoverableGenerating.id, {state: "generating", submittedVerified: true, evidence: {prompt: recoverableGenerating.prompt, conversationId: "conversation-recovery", submittedAt: new Date(Date.now() - 1000).toISOString()}});
const unknownGenerating = make("generating", "generating-no-evidence");

let browserCalls = 0;
const runCalls = [], monitorSchedules = [], unknownSchedules = [];
const recovery = new GenerationOrchestrator({tenantIdProvider: () => truth.tenantId, tasks: bridge, modelGateway: {}, agentBridge: {browser: {execute: async () => { browserCalls += 1; throw new Error("恢复扫描不应直接执行浏览器"); }}}, dataRootProvider: () => tenantRoot});
recovery.run = async taskId => { runCalls.push(taskId); return bridge.bootstrap().tasks.find(item => item.id === taskId); };
recovery.scheduleMonitor = (taskId, delay) => monitorSchedules.push({taskId, delay});
recovery.scheduleUnknownAudit = (taskId, delay) => unknownSchedules.push({taskId, delay});
recovery.beginBrowserTask = async () => {};

(async () => {
  recovery.recoverInterruptedTasks();
  await new Promise(resolve => setTimeout(resolve, 30));
  const snapshot = bridge.bootstrap();
  const byTitle = title => snapshot.tasks.find(item => item.title === title);

  await check("提交前状态在没有不可逆检查点时安全恢复排队", () => {
    for (const state of truth.safeRestartStates) {
      const task = byTitle(`${state}-safe-${state}`);
      assert.equal(task.state, "queued", state);
      assert.equal(task.recoveryState, "safe_pre_submit_restart", state);
      assert(runCalls.includes(task.id), state);
    }
  });
  await check("上传、配置、提交和等待确认在重启后统一进入人工核对", () => {
    for (const state of truth.protectedRestartStates) {
      const task = byTitle(`${state}-protected-${state}`);
      assert.equal(task.state, truth.expectedProtectedState, state);
      assert.equal(task.recoveryState, truth.expectedProtectedRecoveryState, state);
      assert.equal(task.safeToRetry, false, state);
      assert.equal(task.notSentVerified, false, state);
      assert(unknownSchedules.some(item => item.taskId === task.id), state);
    }
  });
  await check("已有不可逆检查点的 preparing 状态禁止自动重发", () => {
    const task = snapshot.tasks.find(item => item.id === irreversiblePreparing.id);
    assert.equal(task.state, "submission_unknown");
    assert.equal(task.executionCheckpoint.irreversible, true);
    assert(!runCalls.includes(task.id));
  });
  await check("有会话证据的 generating 只恢复监控，无证据的转人工核对", () => {
    const recovered = snapshot.tasks.find(item => item.id === recoverableGenerating.id);
    const protectedTask = snapshot.tasks.find(item => item.id === unknownGenerating.id);
    assert.equal(recovered.state, "generating");
    assert(monitorSchedules.some(item => item.taskId === recovered.id));
    assert.equal(protectedTask.state, "submission_unknown");
    assert(!runCalls.includes(recovered.id));
    assert(!runCalls.includes(protectedTask.id));
  });
  await check("恢复扫描不会重新调用浏览器提交", () => assert.equal(browserCalls, truth.expectedProviderResubmissionsDuringRecovery));

  await check("生成自动化超时转提交未知并保留不可逆检查点", async () => {
    const timeoutBridge = new WorkbenchDataBridge({tenantRootProvider: () => path.join(tempRoot, "timeout-tenant")});
    const timeoutProject = timeoutBridge.bootstrap().currentProjectId;
    const task = timeoutBridge.createTask({projectId: timeoutProject, title: "生成超时", prompt: "超时探针", executionChannel: "doubao", state: "queued", accountId: "timeout-account", accountName: "超时账号", doubaoModel: "Seedance 2.0 Mini"});
    const runtime = new GenerationOrchestrator({tenantIdProvider: () => "timeout-tenant", tasks: timeoutBridge, modelGateway: {}, agentBridge: {browser: {execute: async () => new Promise(() => {})}}, dataRootProvider: () => path.join(tempRoot, "timeout-tenant"), browserTimeouts: {generate: 20}});
    runtime.beginBrowserTask = async () => {};
    runtime.scheduleUnknownAudit = () => {};
    await assert.rejects(() => runtime.run(task.id), error => error.code === truth.expectedGenerateTimeoutCode);
    const current = timeoutBridge.bootstrap().tasks.find(item => item.id === task.id);
    assert.equal(current.state, "submission_unknown");
    assert.equal(current.failureCode, truth.expectedGenerateTimeoutCode);
    assert.equal(current.recoveryState, truth.expectedTimeoutRecoveryState);
    assert.equal(current.safeToRetry, false);
    assert.equal(current.executionCheckpoint.phase, "browser_automation_started");
    assert.equal(current.executionCheckpoint.irreversible, true);
    assert(current.executionAttemptId);
    assert(current.lastHeartbeatAt);
    runtime.dispose();
  });

  await check("监控超时停止后续自动操作并转人工保护", async () => {
    const monitorBridge = new WorkbenchDataBridge({tenantRootProvider: () => path.join(tempRoot, "monitor-tenant")});
    const monitorProject = monitorBridge.bootstrap().currentProjectId;
    const task = monitorBridge.createTask({projectId: monitorProject, title: "监控超时", prompt: "监控超时探针", executionChannel: "doubao", state: "generating", accountId: "monitor-account", accountName: "监控账号", conversationId: "monitor-conversation", submittedVerified: true});
    const runtime = new GenerationOrchestrator({tenantIdProvider: () => "monitor-tenant", tasks: monitorBridge, modelGateway: {}, agentBridge: {browser: {execute: async () => new Promise(() => {})}}, dataRootProvider: () => path.join(tempRoot, "monitor-tenant"), browserTimeouts: {monitor: 20}});
    runtime.beginBrowserTask = async () => {};
    const schedules = [];
    runtime.scheduleMonitor = (taskId, delay) => schedules.push({taskId, delay});
    const current = await runtime.monitor(task.id);
    assert.equal(current.state, "submission_unknown");
    assert.equal(current.recoveryState, truth.expectedTimeoutRecoveryState);
    assert.equal(current.failureCode, truth.expectedGenerateTimeoutCode);
    assert.equal(current.accountAction, "hold");
    assert.equal(schedules.length, 0);
    runtime.dispose();
  });

  const failures = checks.filter(item => !item.ok);
  const report = {test: truth.test, timestamp: new Date().toISOString(), groundTruth: truthPath, tempRoot, total: checks.length, passed: checks.length - failures.length, failed: failures.length, browserCalls, runCalls, monitorSchedules, unknownSchedules, checks};
  fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
  fs.writeFileSync(path.join(root, "scripts", "log", "doubao-intermediate-recovery.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  recovery.dispose();
  if (failures.length) process.exitCode = 1;
})().catch(error => { recovery.dispose(); console.error(error.stack || error); process.exitCode = 1; });
