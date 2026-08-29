"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {spawnSync} = require("child_process");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "desktop-model-catalog-ground-truth.json"), "utf8"));
const files = {
  main: fs.readFileSync(path.join(root, "src/main/main.cjs"), "utf8"),
  preload: fs.readFileSync(path.join(root, "src/preload/preload.cjs"), "utf8"),
  renderer: fs.readFileSync(path.join(root, "src/renderer/app-fixes.js"), "utf8"),
};
const checks = [];
const check = (name, operation) => {
  try { operation(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.stack || error)}); }
};

check("desktop model catalog files keep valid syntax", () => {
  for (const file of ["src/main/platform-model-gateway-bridge.cjs", "src/main/main.cjs", "src/preload/preload.cjs", "src/renderer/app-fixes.js"]) {
    const result = spawnSync(process.execPath, ["--check", path.join(root, file)], {encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr || file);
  }
});

check("main and preload expose published catalog separately from executable catalog", () => {
  for (const token of truth.requiredMainChannels) assert(files.main.includes(token), token);
  for (const token of truth.requiredPreloadMethods) assert(files.preload.includes(token), token);
  assert(files.main.includes("refreshDesktopModels"));
  assert(files.main.includes("loadDesktopBootstrap()"));
});

check("home explains published executable and empty catalog states", () => {
  for (const token of truth.requiredHomeCopy) assert(files.renderer.includes(token), token);
  for (const token of truth.requiredHomeSelectors) assert(files.renderer.includes(token), token);
  for (const token of truth.requiredEmptyStates) assert(files.renderer.includes(token), token);
});

check("home loads executable routes and the published catalog in parallel", () => {
  assert(files.renderer.includes("api.models.executionCatalog?.()"));
  assert(files.renderer.includes("api.models.catalog?.()"));
  assert(files.renderer.includes("homeState.catalogModels"));
  assert(files.renderer.includes("renderHomeModelStatus(composer)"));
});

const failed = checks.filter(item => !item.ok);
const report = {test: "desktop-model-catalog", total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks, generatedAt: new Date().toISOString()};
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive: true});
fs.writeFileSync(path.join(logDir, "desktop-model-catalog.json"), JSON.stringify(report, null, 2), "utf8");
console.log(`DESKTOP_MODEL_CATALOG_TESTS ${report.passed}/${report.total}`);
if (failed.length) {
  for (const item of failed) console.error(item.name, item.error);
  process.exit(1);
}
