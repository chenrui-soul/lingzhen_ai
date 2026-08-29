"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "duplicate-out-of-order-events-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
fs.writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`, "utf8");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-duplicate-events-"));
const tenantRoot = path.join(tempRoot, truth.tenantId);
const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
const projectId = bridge.bootstrap().currentProjectId;
const checks = [];
let downloadCalls = 0;

async function check(name, fn) {
  try {
    await fn();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error.stack || error)});
  }
}

function importFixture(name, content = name) {
  const file = path.join(tempRoot, `${name}.mp4`);
  fs.writeFileSync(file, Buffer.from(content));
  return bridge.importAssets({projectId, paths: [file], source: "duplicate-event-fixture"})[0];
}

const task = bridge.createTask({
  projectId,
  title: "重复乱序回调测试",
  prompt: "测试重复回调和乱序状态",
  state: "downloading",
  executionChannel: "model-gateway",
  providerId: "provider-duplicate-test",
  modelId: "model-duplicate-test",
  creationType: "video",
  creationSource: "home"
});

const seeded = bridge.reportTask(task.id, {
  state: "downloading",
  providerJobId: "provider-job-duplicate-test",
  clientRequestId: "client-request-duplicate-test",
  resultType: "video",
  resultUrls: [truth.resultUrls[0], truth.resultUrls[0], truth.resultUrls[1], truth.resultUrls[1]],
  expectedResultCount: truth.expected.uniqueResultItems,
  evidence: {
    tenantId: truth.tenantId,
    providerId: "provider-duplicate-test",
    modelId: "model-duplicate-test",
    providerJobId: "provider-job-duplicate-test",
    clientRequestId: "client-request-duplicate-test",
    submittedAt: new Date(Date.now() - 1000).toISOString()
  }
});

const orchestrator = new GenerationOrchestrator({
  tenantIdProvider: () => truth.tenantId,
  tasks: bridge,
  modelGateway: {},
  agentBridge: {browser: {}},
  dataRootProvider: () => tenantRoot
});

orchestrator.downloadModelResult = async (url, taskId, type, index, key) => {
  downloadCalls += 1;
  await new Promise(resolve => setTimeout(resolve, 20));
  const file = path.join(tempRoot, `${taskId}-${index}-${key}.${type === "video" ? "mp4" : "bin"}`);
  const buffer = Buffer.from(`download-${url}`);
  fs.writeFileSync(file, buffer);
  return {path: file, bytes: buffer.length, checksum: `checksum-${index}`};
};

(async () => {
  await check("重复结果地址在落库前被归一化", () => {
    assert.deepStrictEqual(seeded.resultUrls, truth.resultUrls);
  });

  let firstPromise;
  let secondPromise;
  await check("并发恢复调用共享同一个进行中的 Promise", async () => {
    firstPromise = orchestrator.recoverModelResult(seeded);
    secondPromise = orchestrator.recoverModelResult(seeded);
    assert.strictEqual(firstPromise, secondPromise);
    await Promise.all([firstPromise, secondPromise]);
  });

  const completed = bridge.bootstrap().tasks.find(item => item.id === task.id);
  await check("每个唯一结果只下载一次且只生成一份素材", () => {
    assert.equal(downloadCalls, truth.expected.downloadCalls);
    assert.equal(completed.state, "completed");
    assert.equal(completed.resultItems.length, truth.expected.uniqueResultItems);
    assert.equal(new Set(completed.resultItems.map(item => item.key)).size, truth.expected.uniqueResultItems);
    assert.equal(new Set(completed.resultAssetIds).size, truth.expected.uniqueResultItems);
    assert.equal(completed.recoveredResultCount, truth.expected.uniqueResultItems);
  });

  const beforeLateEvents = JSON.parse(JSON.stringify(completed));
  await check("完成后的迟到生成事件不会回退状态或覆盖结果", () => {
    const late = bridge.reportTask(task.id, {state: "generating", progress: 45, statusText: "迟到的生成中回调", error: "不应写入"});
    assert.equal(late.state, "completed");
    assert.equal(late.progress, 100);
    assert.deepStrictEqual(late.resultAssetIds, beforeLateEvents.resultAssetIds);
    assert.equal(late.error, null);
  });

  await check("完成后的迟到失败事件不会覆盖成功状态", () => {
    const late = bridge.reportTask(task.id, {state: "failed", progress: 0, statusText: "迟到失败", error: "provider late failure"});
    assert.equal(late.state, "completed");
    assert.equal(late.error, null);
    assert.equal(late.resultAssetId, beforeLateEvents.resultAssetId);
  });

  await check("相同完成回调重复到达时保持幂等", () => {
    const completedStepsBefore = bridge.bootstrap().tasks.find(item => item.id === task.id).steps.filter(step => step.state === "completed").length;
    const duplicate = bridge.completeTask(task.id, {
      resultAssetId: completed.resultAssetId,
      resultAssetIds: completed.resultAssetIds,
      resultItems: completed.resultItems,
      expectedResultCount: completed.expectedResultCount,
      resultVid: completed.resultVid,
      resultType: completed.resultType,
      resultUrls: completed.resultUrls,
      providerJobId: completed.providerJobId,
      evidence: completed.evidence
    });
    const completedStepsAfter = duplicate.steps.filter(step => step.state === "completed").length;
    assert.equal(completedStepsBefore, truth.expected.completedTimelineSteps);
    assert.equal(completedStepsAfter, truth.expected.completedTimelineSteps);
    assert.deepStrictEqual(duplicate.resultAssetIds, completed.resultAssetIds);
  });

  await check("完成后的重复恢复不会再次下载结果", async () => {
    const before = downloadCalls;
    const duplicateRecovery = await orchestrator.recoverModelResult(bridge.bootstrap().tasks.find(item => item.id === task.id));
    assert.equal(duplicateRecovery.state, "completed");
    assert.equal(downloadCalls, before);
  });

  const otherAsset = importFixture("other-result", "other-result");
  const otherTask = bridge.createTask({
    projectId,
    title: "结果归属冲突",
    prompt: "ownership conflict",
    state: "verifying",
    executionChannel: "model-gateway",
    providerId: "provider-other",
    modelId: "model-other"
  });
  await check("不同任务重复使用同一 VID 时必须拒绝", () => {
    let error = null;
    try {
      bridge.completeTask(otherTask.id, {
        resultAssetId: otherAsset.id,
        resultVid: completed.resultVid,
        resultType: "video",
        resultUrls: [completed.resultVid],
        evidence: {tenantId: truth.tenantId, providerId: "provider-other", modelId: "model-other", submittedAt: new Date(Date.now() - 1000).toISOString()}
      });
    } catch (value) { error = value; }
    assert(error);
    assert.match(String(error.message || error), /VID/);
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
    downloadCalls,
    checks
  };
  const logPath = path.join(root, "scripts", "log", "duplicate-out-of-order-events.json");
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  orchestrator.dispose();
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  orchestrator.dispose();
  console.error(error.stack || error);
  process.exitCode = 1;
});
