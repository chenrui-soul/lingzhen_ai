"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const projectRoot = path.resolve(__dirname, "..");
const tenantId = "43ec40ae-962a-4c22-9f43-dc6d9e2ce92d";
const dataFile = process.env.LINGFRAME_ACCEPTANCE_DATA_FILE || path.join(
  process.env.APPDATA || "",
  "灵帧AI",
  "tenants",
  tenantId,
  "database",
  "workbench-data-v1.json",
);
const uiEvidenceFile = path.join(projectRoot, "references", "real-concurrency-acceptance-ui-evidence.json");
const outputFile = path.join(projectRoot, "scripts", "log", "real-concurrency-acceptance-20260814.json");

const ids = {
  sameAccountFirst: "4f6d621a841f4679b93739e26c527683",
  sameAccountSecond: "44194e4615a645999aeaf2ad3ff16bfb",
  otherAccountAttempt: "88a3682dc3c24e14bd3386c367d74c08",
  otherAccountSuccess: "5c6ca87dd88e4ac6a457e168bb77f07c",
  sameAccountRetrySuccess: "a8c9e03effa344549eeee48727cd30a7",
  modelGateway: "d547dbcfbc314a2fb3f6781f5bac306b",
};

function isoMs(value) {
  const result = Date.parse(value || "");
  return Number.isFinite(result) ? result : null;
}

function firstStep(task, state) {
  return (task.steps || []).find((step) => step.state === state) || null;
}

function lastStep(task, state) {
  return [...(task.steps || [])].reverse().find((step) => step.state === state) || null;
}

function interval(task, startState = "generating") {
  const start = isoMs(firstStep(task, startState)?.at);
  const end = isoMs(task.updatedAt);
  return start !== null && end !== null ? {start, end} : null;
}

function overlaps(left, right) {
  return Boolean(left && right && Math.max(left.start, right.start) < Math.min(left.end, right.end));
}

function sha256File(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").toUpperCase();
}

function sha256Text(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex").toUpperCase();
}

function assertPresent(value, label) {
  if (!value) throw new Error(`缺少验收数据：${label}`);
  return value;
}

const state = JSON.parse(fs.readFileSync(dataFile, "utf8"));
const uiEvidence = JSON.parse(fs.readFileSync(uiEvidenceFile, "utf8"));
const byId = new Map((state.tasks || []).map((task) => [task.id, task]));
const assetById = new Map((state.assets || []).map((asset) => [asset.id, asset]));
const tasks = Object.fromEntries(Object.entries(ids).map(([key, id]) => [key, assertPresent(byId.get(id), `${key}:${id}`)]));

const a1CompleteAt = isoMs(lastStep(tasks.sameAccountFirst, "completed")?.at);
const a2QueuedStep = (tasks.sameAccountSecond.steps || []).find((step) => step.state === "queued" && /同一账号任务将串行执行/.test(step.message || ""));
const a2PreparingAt = isoMs(firstStep(tasks.sameAccountSecond, "preparing")?.at);
const sameAccountQueued = Boolean(a2QueuedStep && a1CompleteAt !== null && a2PreparingAt !== null && a2PreparingAt >= a1CompleteAt);

const a1Generating = interval(tasks.sameAccountFirst);
const b1Attempt = {
  start: isoMs(tasks.otherAccountAttempt.createdAt),
  end: isoMs(firstStep(tasks.otherAccountAttempt, "submission_unknown")?.at),
};
const differentAccountDispatchOverlap = overlaps(a1Generating, b1Attempt);

const successfulDoubao = [tasks.sameAccountFirst, tasks.otherAccountSuccess, tasks.sameAccountRetrySuccess];
const successfulCrossAccountPairs = [];
for (let leftIndex = 0; leftIndex < successfulDoubao.length; leftIndex += 1) {
  for (let rightIndex = leftIndex + 1; rightIndex < successfulDoubao.length; rightIndex += 1) {
    const left = successfulDoubao[leftIndex];
    const right = successfulDoubao[rightIndex];
    if (left.accountId !== right.accountId && overlaps(interval(left), interval(right))) {
      successfulCrossAccountPairs.push([left.id, right.id]);
    }
  }
}
const differentAccountsTrulyParallel = successfulCrossAccountPairs.length > 0;

const b2Generating = interval(tasks.otherAccountSuccess);
const gatewayInterval = {
  start: isoMs(tasks.modelGateway.createdAt),
  end: isoMs(tasks.modelGateway.updatedAt),
};
const gatewayNotBlocked = tasks.modelGateway.state === "completed" && overlaps(b2Generating, gatewayInterval);

const resultRecords = successfulDoubao.map((task) => {
  const asset = assertPresent(assetById.get(task.resultAssetId), `asset:${task.resultAssetId}`);
  const fileExists = fs.existsSync(asset.path);
  const evidenceMatches = Boolean(
    task.evidence &&
    task.tenantId === tenantId &&
    task.evidence.tenantId === tenantId &&
    task.evidence.accountId === task.accountId &&
    task.evidence.conversationId === task.conversationId &&
    asset.projectId === task.projectId
  );
  return {
    taskId: task.id,
    title: task.title,
    accountId: task.accountId,
    tenantId: task.tenantId,
    projectId: task.projectId,
    conversationId: task.conversationId,
    assetId: asset.id,
    assetPath: asset.path,
    assetSize: asset.size,
    assetFileExists: fileExists,
    assetSha256: fileExists ? sha256File(asset.path) : "",
    videoUrlLength: String(task.resultVid || "").length,
    videoUrlSha256: sha256Text(task.resultVid),
    evidenceMatches,
  };
});

const uniqueAssetIds = new Set(resultRecords.map((item) => item.assetId)).size === resultRecords.length;
const uniqueAssetHashes = new Set(resultRecords.map((item) => item.assetSha256)).size === resultRecords.length;
const uniqueVideoUrls = new Set(resultRecords.map((item) => item.videoUrlSha256)).size === resultRecords.length;
const oneToOneResults = resultRecords.every((item) => item.assetFileExists && item.evidenceMatches && item.videoUrlLength > 0) && uniqueAssetIds && uniqueAssetHashes && uniqueVideoUrls;

const checks = {
  sameAccountSecondQueued: {
    status: sameAccountQueued ? "passed" : "failed",
    firstCompletedAt: lastStep(tasks.sameAccountFirst, "completed")?.at || null,
    secondQueuedAt: a2QueuedStep?.at || null,
    secondReleasedAt: firstStep(tasks.sameAccountSecond, "preparing")?.at || null,
    secondFinalState: tasks.sameAccountSecond.state,
    secondError: tasks.sameAccountSecond.error || null,
  },
  differentAccountsTrulyParallel: {
    status: differentAccountsTrulyParallel ? "passed" : "failed",
    dispatchOverlapObserved: differentAccountDispatchOverlap,
    successfulGeneratingPairs: successfulCrossAccountPairs,
    note: differentAccountsTrulyParallel
      ? "存在不同账号的成功任务生成时间重叠。"
      : "账号 A 与账号 B 曾同时被调度，但账号 B 首次提交进入 submission_unknown；已成功的跨账号任务生成时间没有重叠。",
  },
  modelGatewayNotBlockedByDoubao: {
    status: gatewayNotBlocked ? "passed" : "failed",
    gatewayStartedAt: tasks.modelGateway.createdAt,
    gatewayCompletedAt: tasks.modelGateway.updatedAt,
    gatewayDurationMs: gatewayInterval.end - gatewayInterval.start,
    overlappingDoubaoTaskId: tasks.otherAccountSuccess.id,
    overlappingDoubaoGeneratingAt: firstStep(tasks.otherAccountSuccess, "generating")?.at || null,
    overlappingDoubaoCompletedAt: tasks.otherAccountSuccess.updatedAt,
  },
  taskDockSwitch: uiEvidence.manualObservations.taskDockSwitch,
  resultOwnership: {
    status: oneToOneResults ? "passed" : "failed",
    uniqueAssetIds,
    uniqueAssetHashes,
    uniqueVideoUrls,
    records: resultRecords,
    visualChecks: uiEvidence.manualObservations.visualResultChecks,
  },
  liveViewport: uiEvidence.manualObservations.liveViewport,
};

const report = {
  runId: "REAL3-20260814124854",
  generatedAt: new Date().toISOString(),
  sourceDataFile: dataFile,
  overallStatus: (
    checks.sameAccountSecondQueued.status === "passed" &&
    checks.differentAccountsTrulyParallel.status === "passed" &&
    checks.modelGatewayNotBlockedByDoubao.status === "passed" &&
    checks.taskDockSwitch.status === "passed" &&
    checks.resultOwnership.status === "passed"
  ) ? "passed" : "partial",
  checks,
  conclusion: {
    passed: [
      "同一豆包账号第二条任务进入串行队列，并在第一条完成后释放",
      "模型网关任务在豆包任务生成期间独立完成",
      "三条成功视频的 URL、素材 ID、文件哈希、项目、租户、账号和会话证据一一对应",
    ],
    notPassed: [
      "不同豆包账号的成功任务尚未形成真实生成时间重叠",
      "同账号第二条任务出队后因豆包响应式布局隐藏入口而失败",
      "任务坞只能手动切换活动账号，自动同步与完成任务回看不完整",
    ],
  },
};

fs.mkdirSync(path.dirname(outputFile), {recursive: true});
fs.writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({outputFile, overallStatus: report.overallStatus, checks: Object.fromEntries(Object.entries(checks).map(([key, value]) => [key, value.status]))}, null, 2)}\n`);
if (report.overallStatus !== "passed") process.exitCode = 1;
