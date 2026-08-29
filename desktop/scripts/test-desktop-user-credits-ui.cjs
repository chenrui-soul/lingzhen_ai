"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "desktop-user-credits-ui-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const app = fs.readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const credits = fs.readFileSync(path.join(root, "src", "renderer", "credits-center.js"), "utf8");
const generation = fs.readFileSync(path.join(root, "src", "renderer", "generation-ui.js"), "utf8");
const generationCss = fs.readFileSync(path.join(root, "src", "renderer", "styles", "generation-ui.css"), "utf8");

function normalizeUserCase(item) {
  const displayName = String(item.user.username || item.user.email || "当前用户").trim() || "当前用户";
  const balance = Number.isSafeInteger(Number(item.credits.balance)) && Number(item.credits.balance) >= 0
    ? Number(item.credits.balance)
    : 0;
  return {
    displayName,
    avatar: [...displayName][0]?.toUpperCase() || "U",
    creditLabel: `积分 ${balance.toLocaleString("zh-CN")}`,
  };
}

const results = [];
for (const item of truth.userCases) {
  const actual = normalizeUserCase(item);
  assert.deepEqual(actual, item.expected, item.name);
  results.push({name: item.name, actual, expected: item.expected});
}
for (const item of truth.taskDockCases) {
  const hidden = item.total === 0;
  assert.equal(hidden, item.expectedHidden, item.name);
  results.push({name: item.name, hidden, expectedHidden: item.expectedHidden});
}

assert.match(app, /data-desktop-user/);
assert.match(app, /data-user-avatar/);
assert.match(app, /data-user-credits/);
assert.match(app, /identity\?\.bootstrap\?\.data\?\.credits/);
assert.match(credits, /Promise\.allSettled/);
assert.match(credits, /bootstrapWalletFallback/);
assert.match(generation, /shell\.classList\.toggle\('idle',counts\.total===0\)/);
assert.match(generationCss, /\.generation-live-shell\.idle\s*\{\s*display:\s*none\s*!important;/);

const report = {test: "desktop-user-credits-ui", generatedAt: new Date().toISOString(), source: truthPath, total: results.length, passed: results.length, failed: 0, results};
fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
fs.writeFileSync(path.join(root, "scripts", "log", "desktop-user-credits-ui.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
