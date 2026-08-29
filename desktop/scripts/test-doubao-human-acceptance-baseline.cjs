"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const baselinePath = path.join(root, "references", "doubao-human-acceptance-protected-baseline.json");
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const sources = {
  manager: read("src/main/embedded-browser-manager.cjs"),
  controller: read("src/main/browser-controller.cjs"),
  orchestrator: read("src/main/generation-orchestrator.cjs"),
  data: read("src/main/workbench-data-bridge.cjs"),
  gateway: read("src/main/model-gateway-bridge.cjs"),
  dock: read("src/renderer/generation-ui.js"),
  taskCenter: read("src/renderer/task-center.js"),
  canvas: read("src/renderer/infinite-canvas.js")
};

const checks = [];
function check(name, action) {
  try {
    action();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: error.stack || String(error)});
  }
}
function includesAll(text, markers) {
  for (const marker of markers) assert(text.includes(marker), `missing marker: ${marker}`);
}

check("historical real acceptance is preserved", () => {
  assert.equal(baseline.historicalEvidence.overallStatus, "passed");
  assert.equal(baseline.historicalEvidence.realCompletedVideos, 3);
  for (const [name, passed] of Object.entries(baseline.historicalEvidence.checks)) {
    assert.equal(passed, true, name);
  }
});
check("per-account floating persistent browser", () => {
  includesAll(sources.manager, ["BrowserWindow", "partition", "activeTaskIds", "event.preventDefault()", "activateAccount"]);
  assert(!sources.manager.includes("WebContentsView"));
});
check("same-account serial and cross-account parallel scheduler", () => {
  includesAll(sources.orchestrator, ["accountQueues", "accountKey(task)", "acquireAccount(task)", "releaseAccount(taskId)"]);
});
check("model gateway bypasses Doubao queue", () => {
  const gatewayBranch = sources.orchestrator.indexOf('task.executionChannel === "model-gateway"');
  const doubaoBranch = sources.orchestrator.indexOf("runDoubaoWithFailover(taskId)");
  assert(gatewayBranch >= 0 && doubaoBranch >= 0 && gatewayBranch < doubaoBranch);
});
check("manual verification and original conversation monitoring", () => {
  includesAll(sources.controller, ["conversationId", "submittedEvidence", "action === \"monitor\""]);
  includesAll(sources.orchestrator, ["beginBrowserTask", "scheduleMonitor", "monitor(taskId)"]);
});
check("submission unknown cannot auto retry", () => {
  includesAll(sources.orchestrator + sources.data, ["submission_unknown", "safeToRetry", "notSentVerified"]);
  assert(sources.data.includes("尚未确认任务未发送"));
});
check("quota failover and Shanghai midnight reset", () => {
  includesAll(sources.orchestrator + sources.data, ["markDoubaoQuotaExhausted", "scheduleQuotaResume", "awaiting_quota", "Asia/Shanghai"]);
});
check("task result ownership and original URL", () => {
  includesAll(sources.data + sources.orchestrator, ["resultAssetId", "resultVid", "resultUrls", "conversationId", "tenantId", "accountId"]);
  assert(sources.data.includes("结果视频地址已归属其他任务"));
});
check("global live dock and batch URL copy", () => {
  includesAll(sources.dock, ["document.body.appendChild(shell)", "activateAccount"]);
  includesAll(sources.taskCenter, ["data-task-copy-urls", "resultVid", "copyText(urls.join"]);
});
check("Doubao model, ratio and duration parameters", () => {
  includesAll(sources.data + sources.canvas, ["doubaoModel", "ratio", "duration", "Seedance 2.0 Mini", "Seedance 2.0 Fast"]);
});
check("latest infinite canvas Doubao route remains", () => {
  includesAll(sources.canvas, ["composerNodeId", "composerFocused", "rememberNodeOutput", "expandResultAsNode", "accountCandidates"]);
});
check("model gateway result recovery remains", () => {
  includesAll(sources.gateway + sources.orchestrator, ["providerJobId", "submissionUnknown", "recoveryState", "resultUrls"]);
});

const failed = checks.filter(item => !item.ok);
const report = {
  test: "doubao-human-acceptance-protected-baseline",
  timestamp: new Date().toISOString(),
  baseline: baseline.baseline,
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks
};
const logPath = path.join(root, "scripts", "log", "doubao-human-acceptance-protected-baseline.json");
fs.mkdirSync(path.dirname(logPath), {recursive: true});
fs.writeFileSync(logPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({test: report.test, total: report.total, passed: report.passed, failed: report.failed}, null, 2)}\n`);
if (failed.length) process.exitCode = 1;
