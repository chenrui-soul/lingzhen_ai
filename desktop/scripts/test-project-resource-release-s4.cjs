"use strict";

const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const hash = relative => crypto.createHash("sha256").update(fs.readFileSync(path.join(root, relative))).digest("hex").toUpperCase();
const renderer = read("src/renderer/project-materials.js");
const css = read("src/renderer/styles/project-materials.css");
const s3Root = path.join(root, "backups", "project-resource-finalization-20260817", "S3-after-20260817-131853");
const s3Hashes = JSON.parse(fs.readFileSync(path.join(s3Root, "hashes-after.json"), "utf8"));
const s3Manifest = JSON.parse(fs.readFileSync(path.join(s3Root, "manifest.json"), "utf8"));
const s4Before = JSON.parse(read("backups/project-resource-finalization-20260817/S4-before-20260817-132817/manifest.json"));
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); }
};
const includesAll = (source, values) => values.forEach(value => assert(source.includes(value), `缺少 ${value}`));
const expected = Object.fromEntries(s4Before.snapshots.map(item => [item.path, item.sha256]));

check("S3 accepted gate is the S4 baseline", () => {
  assert.equal(s3Manifest.status, "passed");
  assert.equal(s3Manifest.nextGate, "project-resource-finalization-accepted");
});
check("S4 changes only the confirmed immediate-Escape runtime defect", () => {
  assert.notEqual(hash("src/renderer/project-materials.js"), expected["src/renderer/project-materials.js"]);
  assert.equal(hash("src/renderer/styles/project-materials.css"), expected["src/renderer/styles/project-materials.css"]);
  includesAll(renderer, [
    "const handleModalKeyDown=event=>", "document.addEventListener(\"keydown\",handleModalKeyDown,true)", "document.removeEventListener(\"keydown\",handleModalKeyDown,true)", "event.stopPropagation()"
  ]);
  assert(!renderer.includes("host.addEventListener(\"keydown\""));
});
check("S2 and S3 accepted gates remain byte-for-byte unchanged", () => {
  for (const relative of [
    "scripts/test-project-resource-interface-s2.cjs",
    "scripts/test-project-resource-accessibility-s3.cjs",
    "scripts/test-project-resource-accessibility-s3-runtime.cjs",
    "scripts/test-project-resource-accessibility-s3-contrast.cjs"
  ]) assert.equal(hash(relative), expected[relative], `${relative} 已漂移`);
});
check("S3 protected file gate was fully accepted", () => {
  assert(s3Hashes.protectedUnchanged);
  assert(s3Hashes.protectedChecks.every(item => item.match));
});
check("single project resource entry remains frozen", () => {
  includesAll(renderer, ["项目资源库", "data-resource-mode=\"assets\"", "data-resource-mode=\"projects\""]);
  assert(!renderer.includes("data-resource-legacy"));
});
check("project remains ownership boundary rather than execution lock", () => includesAll(renderer, [
  "项目不增加并发锁", "创建后固定 projectId", "运行任务不随当前项目切换"
]));
check("cross-project usage remains safe copy with a new asset id", () => includesAll(renderer, [
  "api.assets.copy", "sourceAssetId", "sourceProjectId", "未生成独立素材副本"
]));
check("task text canvas and staged references still protect assets", () => includesAll(renderer, [
  "assetUsage", "state.textConversations", "canvasAssetUsage", "lingframe.assetReferences"
]));
check("doubao result binding remains strict and read-only", () => includesAll(renderer, [
  "executionChannel === \"doubao\"", "task.resultAssetId === asset.id", "task.projectId === asset.projectId", "resultVid", "data-copy-doubao-links"
]));
check("result recovery never creates a new generation", () => {
  includesAll(renderer, ["lingframe:generation-status", "pendingResultAssetId", "scheduleMaterialReload"]);
  assert(!renderer.includes("generation.create("));
});
check("submission and account lifecycle are outside the resource runtime", () => {
  for (const forbidden of ["submission_unknown", "releaseAccount", "quotaLock", "conversationId="]) assert(!renderer.includes(forbidden), `资源库不应接管 ${forbidden}`);
});
check("dialog and focus lifecycle remains accepted", () => includesAll(renderer, [
  "role=\"dialog\"", "aria-modal=\"true\"", "event.key===\"Escape\"", "event.key!==\"Tab\"", "returnFocus.focus"
]));
check("cancelled destructive actions return without rerender", () => includesAll(renderer, [
  "if(!await confirmDialog(\"删除项目\"", "if(!await confirmDialog(\"删除素材\""
]));
check("assistive display modes remain accepted", () => includesAll(css, [
  ":focus-visible", "prefers-reduced-motion:reduce", "forced-colors:active"
]));
check("formal production data baseline remains the accepted S3 value", () => {
  assert.equal(s4Before.productionDataBaseline.fileCount, 44);
  assert.equal(s4Before.productionDataBaseline.aggregateSHA256, "30E2FA8AF20EB83967CF602F695853D4ED5F625E205CB1CE1AD642333CD1CF5E");
});

const failed = checks.filter(item => !item.ok);
const result = {test:"project-resource-release-s4", timestamp:new Date().toISOString(), total:checks.length, passed:checks.length-failed.length, failed:failed.length, failures:failed, checks};
const logRoot = path.join(root, "scripts", "log");
fs.mkdirSync(logRoot, {recursive:true});
fs.writeFileSync(path.join(logRoot, "project-resource-release-s4.json"), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
