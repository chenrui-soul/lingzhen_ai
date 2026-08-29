"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge, TASK_STATES} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "task-state-machine-invariants-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
fs.writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`, "utf8");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-task-invariants-"));
const tenantRoot = path.join(tempRoot, truth.tenantId);
const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
const projectA = bridge.bootstrap().currentProjectId;
const projectB = bridge.createProject({name: "状态机隔离项目"}).id;
const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error.stack || error)});
  }
}

function rejects(name, fn, pattern) {
  check(name, () => {
    let error = null;
    try { fn(); } catch (value) { error = value; }
    assert(error, "预期操作被状态机拒绝");
    if (pattern) assert.match(String(error.message || error), pattern);
  });
}

function fixture(name, projectId = projectA) {
  const file = path.join(tempRoot, `${name}.mp4`);
  fs.writeFileSync(file, Buffer.from(`fixture-${name}`));
  return bridge.importAssets({projectId, paths: [file], source: "state-machine-fixture"})[0];
}

function evidence(task, suffix = "base") {
  return {
    tenantId: truth.tenantId,
    accountId: task.accountId,
    conversationId: task.conversationId,
    submittedAt: new Date(Date.now() - 1000).toISOString(),
    requestId: `request-${suffix}`
  };
}

const resultA = fixture("result-a");
const resultB = fixture("result-b");
const resultC = fixture("result-c");
const foreignResult = fixture("foreign-result", projectB);

check("Ground Truth 覆盖当前全部任务状态", () => {
  assert.deepStrictEqual([...TASK_STATES].sort(), truth.requiredStates.slice().sort());
  assert.deepStrictEqual(truth.terminalStates.slice().sort(), ["cancelled", "completed", "failed"]);
});

const flow = bridge.createTask({
  projectId: projectA,
  title: "状态机完成流",
  prompt: "状态机测试",
  state: "generating",
  executionChannel: "doubao",
  accountId: "state-account-a",
  accountName: "状态账号A",
  conversationId: "state-conversation-a"
});

rejects("无结果素材不得完成任务", () => bridge.completeTask(flow.id, {
  resultVid: "https://result.test/no-asset.mp4",
  evidence: evidence(flow, "no-asset")
}), /结果素材不存在/);

rejects("证据不完整不得完成任务", () => bridge.completeTask(flow.id, {
  resultAssetId: resultA.id,
  resultVid: "https://result.test/incomplete-evidence.mp4",
  evidence: {tenantId: truth.tenantId, accountId: flow.accountId}
}), /证据链不完整/);

rejects("跨项目结果不得完成任务", () => bridge.completeTask(flow.id, {
  resultAssetId: foreignResult.id,
  resultVid: "https://result.test/foreign.mp4",
  evidence: evidence(flow, "foreign")
}), /项目不一致/);

const completed = bridge.completeTask(flow.id, {
  resultAssetId: resultA.id,
  resultVid: "https://result.test/state-completed.mp4",
  resultType: "video",
  resultUrls: ["https://result.test/state-completed.mp4"],
  evidence: evidence(flow, "complete")
});

check("完成任务强制满足结果与进度不变量", () => {
  assert.equal(completed.state, "completed");
  assert.equal(completed.stage, "completed");
  assert.equal(completed.progress, 100);
  assert.equal(completed.progressMode, "determinate");
  assert.equal(completed.error, null);
  assert.equal(completed.resultAssetId, resultA.id);
  assert.equal(completed.evidence.tenantId, truth.tenantId);
});

check("已完成任务不能被迟到的生成事件重新打开", () => {
  const afterLateEvent = bridge.reportTask(flow.id, {state: "generating", progress: 45, statusText: "迟到的生成事件"});
  assert.equal(afterLateEvent.state, "completed");
  assert.equal(afterLateEvent.progress, 100);
  assert.equal(afterLateEvent.resultAssetId, resultA.id);
});

for (const state of truth.normallyCancelableStates) {
  const task = bridge.createTask({projectId: projectA, title: `可取消-${state}`, prompt: state, state, executionChannel: "doubao", accountId: `cancel-${state}`});
  check(`${state} 状态允许本地取消`, () => {
    const cancelled = bridge.cancelTask(task.id);
    assert.equal(cancelled.state, "cancelled");
    assert.equal(cancelled.stage, "cancelled");
  });
}

const active = bridge.createTask({projectId: projectA, title: "生成中禁止普通取消", prompt: "active", state: "generating", executionChannel: "doubao", accountId: "active-account"});
rejects("已进入生成阶段的豆包任务禁止伪取消", () => bridge.cancelTask(active.id), /无法取消豆包服务器上的任务/);

const unsafeFailure = bridge.createTask({projectId: projectA, title: "证据不足失败", prompt: "unsafe", state: "failed", executionChannel: "doubao", safeToRetry: false, notSentVerified: false, terminalFailureVerified: false});
rejects("证据不足的失败任务禁止重试", () => bridge.retryTask(unsafeFailure.id), /禁止自动重试/);

const unknown = bridge.createTask({projectId: projectA, title: "提交未知", prompt: "unknown", state: "submission_unknown", executionChannel: "doubao", safeToRetry: false, notSentVerified: false});
rejects("提交状态未知不能直接重试", () => bridge.retryTask(unknown.id), /禁止自动重试/);

const safeFailure = bridge.createTask({
  projectId: projectA,
  title: "厂商已明确失败",
  prompt: "safe retry",
  state: "failed",
  executionChannel: "doubao",
  accountId: "retry-account",
  accountName: "重试账号",
  safeToRetry: true,
  notSentVerified: false,
  terminalFailureVerified: true,
  submittedVerified: true,
  failureCode: "PROVIDER_FAILED",
  retryMode: "retry_or_edit"
});
const child = bridge.retryTask(safeFailure.id);
check("安全重试创建干净子任务并保留原任务", () => {
  const parent = bridge.bootstrap().tasks.find(item => item.id === safeFailure.id);
  assert.equal(parent.state, "failed");
  assert.equal(child.parentTaskId, safeFailure.id);
  assert.equal(child.state, "queued");
  assert.equal(child.progress, 0);
  assert.equal(child.evidence, null);
  assert.equal(child.resultAssetId, "");
  assert.equal(child.resultVid, "");
  assert.equal(child.clientRequestId, "");
  assert.equal(child.providerJobId, "");
  assert.equal(child.safeToRetry, false);
  assert.equal(child.terminalFailureVerified, false);
});

const duplicateVidTask = bridge.createTask({projectId: projectA, title: "重复VID", prompt: "duplicate vid", state: "verifying", executionChannel: "doubao", accountId: "state-account-b", conversationId: "state-conversation-b"});
rejects("结果 VID 不能归属两个任务", () => bridge.completeTask(duplicateVidTask.id, {
  resultAssetId: resultB.id,
  resultVid: completed.resultVid,
  evidence: evidence(duplicateVidTask, "duplicate-vid")
}), /VID/);

const duplicateAssetTask = bridge.createTask({projectId: projectA, title: "重复素材", prompt: "duplicate asset", state: "verifying", executionChannel: "doubao", accountId: "state-account-c", conversationId: "state-conversation-c"});
rejects("结果素材不能归属两个任务", () => bridge.completeTask(duplicateAssetTask.id, {
  resultAssetId: resultA.id,
  resultVid: "https://result.test/unique-vid.mp4",
  evidence: evidence(duplicateAssetTask, "duplicate-asset")
}), /已归属其他任务/);

const validSecond = bridge.createTask({projectId: projectA, title: "第二个有效完成任务", prompt: "second", state: "verifying", executionChannel: "doubao", accountId: "state-account-d", conversationId: "state-conversation-d"});
bridge.completeTask(validSecond.id, {resultAssetId: resultC.id, resultVid: "https://result.test/state-second.mp4", evidence: evidence(validSecond, "second")});

rejects("不存在的任务状态必须被拒绝", () => bridge.reportTask(active.id, {state: "mystery_state"}), /任务状态无效/);

const heartbeat = bridge.createTask({projectId: projectA, title: "监控时间线聚合", prompt: "heartbeat", state: "queued", executionChannel: "doubao", accountId: "heartbeat-account"});
bridge.reportTask(heartbeat.id, {state: "generating", statusText: "第1次安全检查", stepGroup: "doubao-monitor-heartbeat", replaceStepGroup: true});
bridge.reportTask(heartbeat.id, {state: "generating", statusText: "第2次安全检查", stepGroup: "doubao-monitor-heartbeat", replaceStepGroup: true});
check("重复监控心跳只保留最新一条时间线", () => {
  const task = bridge.bootstrap().tasks.find(item => item.id === heartbeat.id);
  const steps = task.steps.filter(step => step.group === "doubao-monitor-heartbeat");
  assert.equal(steps.length, 1);
  assert.match(steps[0].message, /第2次/);
});

check("全部持久化任务满足全局状态不变量", () => {
  const snapshot = bridge.bootstrap();
  assert.equal(new Set(snapshot.tasks.map(item => item.id)).size, snapshot.tasks.length, "任务 ID 必须唯一");
  for (const task of snapshot.tasks) {
    assert(TASK_STATES.has(task.state), `非法任务状态：${task.state}`);
    if (task.state === "completed") {
      assert(task.resultAssetId, `${task.title} 缺少结果素材`);
      assert(task.resultAssetIds.length >= 1, `${task.title} 缺少结果素材列表`);
      assert.equal(task.progress, 100);
      assert.equal(task.error, null);
      assert(task.evidence?.tenantId === truth.tenantId);
    }
    if (truth.terminalStates.includes(task.state)) {
      const late = bridge.reportTask(task.id, {state: "generating", statusText: "全局迟到事件"});
      assert.equal(late.state, task.state, `${task.title} 被迟到事件重新打开`);
    }
  }
});

const failures = checks.filter(item => !item.ok);
const report = {
  test: truth.test,
  timestamp: new Date().toISOString(),
  groundTruth: truthPath,
  tempRoot,
  total: checks.length,
  passed: checks.length - failures.length,
  failed: failures.length,
  checks
};
const logPath = path.join(root, "scripts", "log", "task-state-machine-invariants.json");
fs.mkdirSync(path.dirname(logPath), {recursive: true});
fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;
