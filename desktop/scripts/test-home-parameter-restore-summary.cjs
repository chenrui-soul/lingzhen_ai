"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-parameter-restore-ground-truth.json"), "utf8"));
const reports = truth.viewports.map(viewport => JSON.parse(fs.readFileSync(path.join(root, "scripts", "log", `home-parameter-restore-${viewport.width}.json`), "utf8")));
const checks = reports.flatMap(report => report.checks || []);
const failed = checks.filter(item => !item.ok);
const fatal = reports.map(report => report.fatal).filter(Boolean);
const result = {
  test: "home-parameter-restore-runtime-summary",
  timestamp: new Date().toISOString(),
  groundTruth: truth,
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  fatal,
  checks,
  screenshots: reports.flatMap(report => report.screenshots || [])
};
fs.writeFileSync(path.join(root, "scripts", "log", "home-parameter-restore-runtime.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length || fatal.length) process.exitCode = 1;
