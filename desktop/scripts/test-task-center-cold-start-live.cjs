"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "task-center-cold-start-live-ground-truth.json"), "utf8"));
const report = JSON.parse(fs.readFileSync(path.join(root, "scripts", "log", "task-center-cold-start-live-2026-08-26.json"), "utf8"));
const expected = truth.expected;
const actual = report.afterFix;
const checks = [
  ["冷启动无需手动刷新", actual.requiresManualRefresh === expected.requiresManualRefresh],
  ["冷启动不显示空任务", actual.showedEmptyState === false],
  ["已完成任务数量正确", actual.completedCount === expected.completedCount],
  ["失败任务数量正确", actual.failedCount === expected.failedCount],
  ["项目素材数量正确", actual.assetCount === expected.assetCount],
  ["豆包账号自动恢复登录", actual.accountCount === expected.accountCount && actual.loggedInCount === expected.loggedInCount],
];
for (const [name, passed] of checks) assert.equal(passed, true, name);
console.log(JSON.stringify({test:truth.test,total:checks.length,passed:checks.length,failed:0,checkedAt:report.checkedAt}, null, 2));
