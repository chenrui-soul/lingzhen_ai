"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const referencePath = path.join(root, "references", "doubao-monitor-state-ground-truth.json");
const logPath = path.join(root, "scripts", "log", "doubao-monitor-state.json");
const {GenerationOrchestrator} = require(path.join(root, "src", "main", "generation-orchestrator.cjs"));
const {WorkbenchDataBridge} = require(path.join(root, "src", "main", "workbench-data-bridge.cjs"));

function generateGroundTruth() {
  const truth = {
    pendingVideoError: "等待当前任务视频资源超时",
    pendingState: "generating",
    pendingError: null,
    monitorStepGroup: "doubao-monitor-heartbeat",
    expectedHeartbeatSteps: 1,
    formalDownloadError: "视频下载校验失败",
    preservedInvariants: [
      "monitor timeout remains generating",
      "monitor timeout never becomes a formal task error",
      "download recovery errors remain formal errors",
      "submission evidence and account scheduling are unchanged"
    ]
  };
  fs.mkdirSync(path.dirname(referencePath), {recursive: true});
  fs.writeFileSync(referencePath, JSON.stringify(truth, null, 2) + "\n", "utf8");
  return truth;
}

function taskStore(task) {
  const reports = [];
  return {
    reports,
    bootstrap: () => ({tasks: [task], assets: []}),
    reportTask: (_id, patch) => { reports.push({...patch}); Object.assign(task, patch); return {...task}; }
  };
}

async function runMonitorScenario(truth, browserResult) {
  const task = {
    id: "monitor-task",
    title: "监控测试",
    prompt: "监控测试提示词",
    projectId: "project-1",
    executionChannel: "doubao",
    accountId: "account-1",
    accountName: "账号1",
    doubaoModel: "Seedance 2.0 Mini",
    ratio: "自动",
    duration: "10s",
    state: "generating",
    stage: "monitoring",
    progress: 45,
    assetIds: [],
    evidence: {prompt: "监控测试提示词", conversationId: "123456789"},
    conversationId: "123456789",
    submittedVerified: true,
    error: null,
    monitorError: ""
  };
  const store = taskStore(task);
  const orchestrator = new GenerationOrchestrator({
    tenantIdProvider: () => "tenant-1",
    tasks: store,
    modelGateway: {},
    agentBridge: {browser: {execute: async () => ({...browserResult})}},
    dataRootProvider: () => root
  });
  orchestrator.scheduleMonitor = () => {};
  orchestrator.pauseDoubaoResultRecovery = async () => ({...task});
  const result = await orchestrator.runDoubao(task, "monitor");
  return {task, reports: store.reports, result};
}

(async () => {
  const truth = generateGroundTruth();
  const checks = [];
  const check = (name, ok, detail = null) => checks.push({name, ok: Boolean(ok), detail});

  const pending = await runMonitorScenario(truth, {
    ok: true,
    state: "generating",
    generating: true,
    resumed: true,
    videoPending: true,
    videoError: truth.pendingVideoError,
    conversationId: "123456789",
    message: "已恢复原会话，继续监控；未重新发送提示词"
  });
  check("普通视频等待超时仍保持生成中", pending.task.state === truth.pendingState, pending);
  check("普通视频等待超时不写入正式错误", pending.task.error === truth.pendingError, pending);
  check("普通视频等待超时写入监控诊断", pending.task.monitorError === truth.pendingVideoError, pending);
  check("普通视频等待超时保留提交证据", pending.task.submittedVerified === true && pending.task.conversationId === "123456789", pending.task);

  const download = await runMonitorScenario(truth, {
    ok: true,
    state: "downloading",
    resultDownloadFailed: true,
    videoPending: true,
    videoError: truth.formalDownloadError,
    videoUrl: "https://example.invalid/result.mp4",
    resultUrls: ["https://example.invalid/result.mp4"],
    conversationId: "123456789",
    code: "DOUBAO_RESULT_DOWNLOAD_FAILED",
    category: "result_download",
    retryMode: "recover_result",
    message: "结果已生成，正在恢复下载"
  });
  check("正式下载错误仍保留错误与恢复语义", download.task.error === truth.formalDownloadError && download.task.state === "downloading" && download.task.retryMode === "recover_result" && download.reports.at(-1)?.appendStep === true, download);

  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-monitor-state-"));
  const bridge = new WorkbenchDataBridge({tenantRootProvider: () => dataRoot});
  const project = bridge.createProject({name: "监控时间线测试"});
  const timelineTask = bridge.createTask({projectId: project.id, title: "时间线聚合", prompt: "时间线聚合", executionChannel: "doubao", state: "queued"});
  bridge.reportTask(timelineTask.id, {state: "generating", statusText: "豆包仍在生成；已完成第 1 次安全检查", stepGroup: truth.monitorStepGroup, replaceStepGroup: true});
  bridge.reportTask(timelineTask.id, {state: "generating", statusText: "豆包仍在生成；已完成第 2 次安全检查", stepGroup: truth.monitorStepGroup, replaceStepGroup: true});
  const timeline = bridge.bootstrap().tasks.find(item => item.id === timelineTask.id);
  const heartbeatSteps = timeline.steps.filter(item => item.group === truth.monitorStepGroup);
  check("连续安全检查只保留一条聚合时间线", heartbeatSteps.length === truth.expectedHeartbeatSteps, timeline.steps);
  check("聚合时间线保留最新检查次数", heartbeatSteps[0]?.message.includes("第 2 次安全检查"), heartbeatSteps);
  bridge.reportTask(timelineTask.id, {state: "verifying", statusText: "豆包视频已下载，正在校验"});
  const afterVerify = bridge.bootstrap().tasks.find(item => item.id === timelineTask.id);
  check("关键状态变化仍正常追加时间线", afterVerify.steps.at(-1)?.state === "verifying", afterVerify.steps);

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-monitor-state", timestamp: new Date().toISOString(), groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
