"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(
  path.join(root, "references", "tenant-runtime-auth-refresh-live-ground-truth.json"),
  "utf8",
));
const report = JSON.parse(fs.readFileSync(
  path.join(root, "scripts", "log", "tenant-runtime-auth-refresh-live-2026-08-26.json"),
  "utf8",
));

const expected = truth.expected;
const task = report.refreshTask;
const checks = [
  ["真实任务已确认提交", task.submittedVerified === expected.submittedVerified],
  ["刷新后保留会话 VID", !expected.conversationVidRequired || Boolean(task.conversationVid)],
  ["刷新后任务仍处于允许状态", expected.allowedStatesAfterRefresh.includes(task.state)],
  ["未产生豆包执行中断错误", !expected.forbiddenFailureCodes.includes(task.failureCode)],
  ["未进入 submission_unknown", task.submissionUnknownSteps === expected.submissionUnknownSteps],
  ["未进入 manual_review", task.manualReviewSteps === expected.manualReviewSteps],
];

for (const [name, passed] of checks) assert.equal(passed, true, name);

const result = {
  test: truth.test,
  total: checks.length,
  passed: checks.length,
  failed: 0,
  taskId: task.id,
  state: task.state,
  stage: task.stage,
  conversationVid: task.conversationVid,
  refreshTriggeredAt: task.refreshTriggeredAt,
  checkedAt: task.checkedAt,
};

console.log(JSON.stringify(result, null, 2));
