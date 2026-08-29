"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "crash-restart-checkpoints-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
fs.writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`, "utf8");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-crash-restart-"));
const tenantRoot = path.join(tempRoot, truth.tenantId);
const bridgeBeforeCrash = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
const projectId = bridgeBeforeCrash.bootstrap().currentProjectId;
const checks = [];

function check(name, fn) {
  try {
    fn();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error.stack || error)});
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error.stack || error)});
  }
}

function createDoubao(input) {
  return bridgeBeforeCrash.createTask({projectId, executionChannel: "doubao", doubaoModel: "Seedance 2.0 Mini", ratio: "16:9", duration: "10s", ...input});
}

function createModel(input) {
  return bridgeBeforeCrash.createTask({projectId, executionChannel: "model-gateway", providerId: "provider-restart", modelId: "model-restart", creationType: "video", ...input});
}

const cleanQueued = createDoubao({id: "ignored", title: "崩溃前尚未提交", prompt: "clean queued", state: "queued", accountId: "restart-account-clean", accountName: "干净账号"});

const protectedQueuedBase = createDoubao({title: "崩溃前已有提交证据", prompt: "protected queued", state: "queued", accountId: "restart-account-protected", accountName: "保护账号", conversationId: "conversation-protected"});
const protectedQueued = bridgeBeforeCrash.reportTask(protectedQueuedBase.id, {
  state: "queued",
  conversationId: "conversation-protected",
  submittedVerified: true,
  evidence: {prompt: "protected queued", conversationId: "conversation-protected", submittedAt: new Date(Date.now() - 3000).toISOString()}
});

const generatingBase = createDoubao({title: "崩溃前正在生成", prompt: "generating checkpoint", state: "generating", accountId: "restart-account-generating", accountName: "生成账号", conversationId: "conversation-generating"});
const generating = bridgeBeforeCrash.reportTask(generatingBase.id, {
  state: "generating",
  progress: 45,
  conversationId: "conversation-generating",
  submittedVerified: true,
  evidence: {prompt: "generating checkpoint", conversationId: "conversation-generating", submittedAt: new Date(Date.now() - 2500).toISOString()}
});

const downloadingBase = createDoubao({title: "崩溃前正在回传", prompt: "download checkpoint", state: "downloading", accountId: "restart-account-download", accountName: "回传账号", conversationId: "conversation-download"});
const downloading = bridgeBeforeCrash.reportTask(downloadingBase.id, {
  state: "downloading",
  progress: 88,
  resultType: "video",
  resultUrls: ["https://result.test/restart-doubao.mp4"],
  submittedVerified: true,
  evidence: {prompt: "download checkpoint", conversationId: "conversation-download", submittedAt: new Date(Date.now() - 2000).toISOString()}
});

const modelSubmittingBase = createModel({title: "崩溃在模型提交中", prompt: "model submitting", state: "submitting"});
const modelSubmitting = bridgeBeforeCrash.reportTask(modelSubmittingBase.id, {
  state: "submitting",
  clientRequestId: "client-restart-submitting",
  evidence: {tenantId: truth.tenantId, providerId: "provider-restart", modelId: "model-restart", clientRequestId: "client-restart-submitting", submissionStartedAt: new Date(Date.now() - 1800).toISOString()}
});

const modelGeneratingBase = createModel({title: "崩溃前厂商正在生成", prompt: "model generating", state: "generating"});
const modelGenerating = bridgeBeforeCrash.reportTask(modelGeneratingBase.id, {
  state: "generating",
  progress: 45,
  providerJobId: "provider-job-restart-generating",
  clientRequestId: "client-restart-generating",
  evidence: {tenantId: truth.tenantId, providerId: "provider-restart", modelId: "model-restart", providerJobId: "provider-job-restart-generating", clientRequestId: "client-restart-generating", submittedAt: new Date(Date.now() - 1500).toISOString()}
});

const partialBase = createModel({title: "崩溃前部分结果已入库", prompt: "partial checkpoint", state: "downloading"});
const partialSeed = bridgeBeforeCrash.reportTask(partialBase.id, {
  state: "downloading",
  progress: 90,
  providerJobId: "provider-job-restart-partial",
  clientRequestId: "client-restart-partial",
  resultType: "video",
  resultUrls: ["https://result.test/restart-partial-1.mp4", "https://result.test/restart-partial-2.mp4"],
  expectedResultCount: 2,
  evidence: {tenantId: truth.tenantId, providerId: "provider-restart", modelId: "model-restart", providerJobId: "provider-job-restart-partial", clientRequestId: "client-restart-partial", submittedAt: new Date(Date.now() - 1200).toISOString()}
});

const seedRuntime = new GenerationOrchestrator({tenantIdProvider: () => truth.tenantId, tasks: bridgeBeforeCrash, modelGateway: {}, agentBridge: {browser: {}}, dataRootProvider: () => tenantRoot});
const seededItems = seedRuntime.buildResultItems(partialSeed, partialSeed.resultUrls, "video");
const importedFile = path.join(tempRoot, "already-imported.mp4");
fs.writeFileSync(importedFile, Buffer.from("already-imported-before-crash"));
const importedAsset = bridgeBeforeCrash.importAssets({projectId, paths: [importedFile], source: "crash-checkpoint-fixture", dedupeKey: seededItems[0].key})[0];
bridgeBeforeCrash.checkpointModelResultItem(partialSeed.id, {item: {...seededItems[0], status: "imported", assetId: importedAsset.id, bytes: 29, checksum: "checkpoint-one"}, expectedResultCount: 2});
bridgeBeforeCrash.checkpointModelResultItem(partialSeed.id, {item: seededItems[1], expectedResultCount: 2});
seedRuntime.dispose();

const persistedBeforeRestart = bridgeBeforeCrash.bootstrap();
const bridgeAfterRestart = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
const persistedAfterRestart = bridgeAfterRestart.bootstrap();

let providerGenerateCalls = 0;
let browserExecuteCalls = 0;
const cleanRuns = [];
const monitorSchedules = [];
const unknownSchedules = [];
const modelRecoverySchedules = [];
const beginBrowserCalls = [];

const restartRuntime = new GenerationOrchestrator({
  tenantIdProvider: () => truth.tenantId,
  tasks: bridgeAfterRestart,
  modelGateway: {generate: async () => { providerGenerateCalls += 1; throw new Error("重启恢复不应重新生成"); }},
  agentBridge: {browser: {execute: async () => { browserExecuteCalls += 1; throw new Error("重启扫描不应立即操作豆包"); }}},
  dataRootProvider: () => tenantRoot
});
restartRuntime.run = async taskId => { cleanRuns.push(taskId); return bridgeAfterRestart.bootstrap().tasks.find(item => item.id === taskId); };
restartRuntime.scheduleMonitor = (taskId, delay) => monitorSchedules.push({taskId, delay});
restartRuntime.scheduleUnknownAudit = (taskId, delay) => unknownSchedules.push({taskId, delay});
restartRuntime.scheduleModelRecovery = (taskId, delay) => modelRecoverySchedules.push({taskId, delay});
restartRuntime.beginBrowserTask = async task => { beginBrowserCalls.push(task.id); };

(async () => {
  check("崩溃前的任务、结果检查点和素材完整落盘", () => {
    assert.equal(persistedAfterRestart.tasks.length, persistedBeforeRestart.tasks.length);
    assert.equal(persistedAfterRestart.assets.length, persistedBeforeRestart.assets.length);
    const partial = persistedAfterRestart.tasks.find(item => item.id === partialSeed.id);
    assert.equal(partial.resultItems.length, 2);
    assert.equal(partial.resultItems[0].status, "imported");
    assert.equal(partial.resultItems[0].assetId, importedAsset.id);
    assert.equal(partial.recoveredResultCount, 1);
  });

  restartRuntime.recoverInterruptedTasks();
  await new Promise(resolve => setTimeout(resolve, 40));

  const snapshot = bridgeAfterRestart.bootstrap();
  const byId = id => snapshot.tasks.find(item => item.id === id);

  check("无提交证据的排队任务重启后只恢复一次调度", () => {
    assert.deepStrictEqual(cleanRuns, [cleanQueued.id]);
  });
  check("已有提交证据的排队任务进入提交未知并锁定原账号", () => {
    const task = byId(protectedQueued.id);
    assert.equal(task.state, truth.expected.protectedQueuedState);
    assert.equal(task.notSentVerified, false);
    assert.equal(task.safeToRetry, false);
    assert(unknownSchedules.some(item => item.taskId === task.id));
    assert.equal(restartRuntime.accountOwners.get(restartRuntime.accountKey(task)), task.id);
    assert(!cleanRuns.includes(task.id));
  });
  check("已有完整证据的生成中任务只恢复监控不重新提交", () => {
    const task = byId(generating.id);
    assert.equal(task.state, "generating");
    assert(monitorSchedules.some(item => item.taskId === task.id));
    assert(beginBrowserCalls.includes(task.id));
    assert(!cleanRuns.includes(task.id));
  });
  check("豆包回传中崩溃后转为人工重新回传而不是重新生成", () => {
    const task = byId(downloading.id);
    assert.equal(task.state, truth.expected.doubaoDownloadRecoveryState);
    assert.equal(task.recoveryState, "result_review_required");
    assert.deepStrictEqual(task.resultUrls, downloading.resultUrls);
    assert.match(task.userAction, /重新回传/);
  });
  check("模型提交中崩溃后进入提交未知并通过标识恢复查询", () => {
    const task = byId(modelSubmitting.id);
    assert.equal(task.state, truth.expected.modelSubmittingState);
    assert.equal(task.clientRequestId, modelSubmitting.clientRequestId);
    assert(modelRecoverySchedules.some(item => item.taskId === task.id));
  });
  check("已有厂商任务 ID 的模型任务只安排查询恢复", () => {
    const task = byId(modelGenerating.id);
    assert.equal(task.state, "generating");
    assert(modelRecoverySchedules.some(item => item.taskId === task.id));
    assert.equal(task.providerJobId, modelGenerating.providerJobId);
  });
  check("重启扫描本身不会重新调用豆包或模型生成", () => {
    assert.equal(providerGenerateCalls, truth.expected.providerResubmissions);
    assert.equal(browserExecuteCalls, 0);
  });

  let partialDownloadCalls = 0;
  const resumeRuntime = new GenerationOrchestrator({
    tenantIdProvider: () => truth.tenantId,
    tasks: bridgeAfterRestart,
    modelGateway: {generate: async () => { providerGenerateCalls += 1; throw new Error("检查点恢复不应重新生成"); }},
    agentBridge: {browser: {}},
    dataRootProvider: () => tenantRoot
  });
  resumeRuntime.downloadModelResult = async (url, taskId, type, index, key) => {
    partialDownloadCalls += 1;
    const file = path.join(tempRoot, `${taskId}-${index}-${key}.${type === "video" ? "mp4" : "bin"}`);
    const buffer = Buffer.from(`resumed-${url}`);
    fs.writeFileSync(file, buffer);
    return {path: file, bytes: buffer.length, checksum: `resumed-${index}`};
  };

  await checkAsync("部分结果检查点恢复时只下载未完成项", async () => {
    const partial = bridgeAfterRestart.bootstrap().tasks.find(item => item.id === partialSeed.id);
    const completed = await resumeRuntime.recoverModelResult(partial);
    assert.equal(completed.state, "completed");
    assert.equal(partialDownloadCalls, truth.expected.partialResultDownloadCalls);
    assert.equal(completed.resultAssetIds.length, 2);
    assert(completed.resultAssetIds.includes(importedAsset.id));
    assert.equal(completed.recoveredResultCount, 2);
    assert.equal(providerGenerateCalls, truth.expected.providerResubmissions);
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
    providerGenerateCalls,
    browserExecuteCalls,
    partialDownloadCalls,
    schedules: {monitorSchedules, unknownSchedules, modelRecoverySchedules},
    checks
  };
  const logPath = path.join(root, "scripts", "log", "crash-restart-checkpoints.json");
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  restartRuntime.dispose();
  resumeRuntime.dispose();
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  restartRuntime.dispose();
  console.error(error.stack || error);
  process.exitCode = 1;
});
