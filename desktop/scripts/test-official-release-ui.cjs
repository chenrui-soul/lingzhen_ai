"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "official-release-ui-ground-truth.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const appUi = fs.readFileSync(path.join(root, "src", "renderer", "app.js"), "utf8");
const updateUi = fs.readFileSync(path.join(root, "src", "renderer", "auto-update-ui.js"), "utf8");
const releaseScript = fs.readFileSync(path.join(root, "scripts", "prepare-update-release.cjs"), "utf8");
const updateConfig = JSON.parse(fs.readFileSync(path.join(root, "assets", "update-config.json"), "utf8"));

const results = [];
function check(name, fn) {
  try { fn(); results.push({name, ok: true}); }
  catch (error) { results.push({name, ok: false, error: String(error.message || error)}); }
}

check("正式版产品与安装包命名", () => {
  assert.equal(pkg.version, truth.version);
  assert.equal(pkg.productName, truth.productName);
  assert.equal(pkg.build.productName, truth.productName);
  assert.equal(pkg.build.win.artifactName, truth.artifactName);
  assert(releaseScript.includes('const expected = "灵帧AI-Setup-x64.exe"'));
  assert(!releaseScript.includes("灵帧AI内测版"));
});

check("主界面不显示版本号或内测标识", () => {
  for (const marker of truth.forbiddenUserFacingMarkers.slice(0, 4)) assert(!appUi.includes(marker), marker);
  for (const marker of truth.requiredStatusMarkers) assert(appUi.includes(marker), marker);
});

check("更新界面不展示具体版本号", () => {
  for (const marker of truth.forbiddenUserFacingMarkers.slice(4)) assert(!updateUi.includes(marker), marker);
  assert(!/V\$\{(?:esc\()?status\?\.version/.test(updateUi));
  assert(!/V\$\{(?:esc\()?info\.version/.test(updateUi));
});

check("发布配置使用正式版文案", () => {
  assert(!String(updateConfig.note || "").includes("内测"));
  assert.equal(updateConfig.channel, "stable");
});

const failed = results.filter(item => !item.ok);
const report = {ok: failed.length === 0, generatedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed, results};
fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
fs.writeFileSync(path.join(root, "scripts", "log", "official-release-ui.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
