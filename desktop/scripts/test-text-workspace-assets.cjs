"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const source = read("src/renderer/text-workspace-assets.js");
const css = read("src/renderer/styles/text-workspace.css");
const index = read("src/renderer/index.html");
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, ok:true}); } catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); } }

check("asset adapter loads after layout adapter", () => {
  assert(index.indexOf("./text-workspace-layout.js") >= 0);
  assert(index.indexOf("./text-workspace-assets.js") > index.indexOf("./text-workspace-layout.js"));
});
check("single source bootstrap", () => {
  assert(source.includes("api.workbench.bootstrap()"));
  assert(source.includes("data.assets"));
  assert(!source.includes("copyFileSync"));
  assert(!source.includes("assetDatabase"));
});
check("same project and text type filtering", () => {
  for (const marker of ["asset.projectId === projectId", "asset.type === \"text\"", "deletedAt", "archivedAt"]) assert(source.includes(marker), marker);
});
check("source categories and search", () => {
  for (const marker of ["AI 生成", "本地上传", "文献参考", "项目资料", "历史版本", "data-text-asset-search"]) assert(source.includes(marker), marker);
});
check("preview copy extract insert actions", () => {
  for (const marker of ["data-text-asset-action=\"preview\"", "data-text-asset-action=\"copy\"", "data-text-asset-action=\"extract\"", "data-text-asset-action=\"insert\"", "api.assets.readText"]) assert(source.includes(marker), marker);
  assert(!source.includes('host.dataset.textAssetsBound === "1"'), "rendered buttons must be rebound after host.innerHTML replacement");
});
check("insert requires confirmation", () => {
  assert(source.includes("data-text-asset-confirm"));
  assert(source.includes("确认插入"));
  assert(source.includes("insertPreview"));
});
check("drag evidence and project rejection", () => {
  for (const marker of ["application/x-lingframe-text-asset", "dataTransfer", "只能引用当前项目的文本素材", "projectId:asset.projectId"]) assert(source.includes(marker), marker);
});
check("duplicate insertion protection", () => {
  for (const marker of ["_textAssetInsertKeys", "insertionKey", "已经插入过"]) assert(source.includes(marker), marker);
});
check("source trace is retained", () => {
  for (const marker of ["assetId:", "sourceLine", "来源信息", "sourceLabel"]) assert(source.includes(marker), marker);
});
check("asset center changes refresh text view", () => {
  for (const marker of ["refreshActive", "visibilitychange", "setInterval(refreshActive, 8000)"]) assert(source.includes(marker), marker);
});
check("excerpt uses shared text asset contract", () => {
  for (const marker of ["api.assets.createText", "保存到素材中心", "sourceAssetId:asset.id", "sourceLocation:"]) assert(source.includes(marker), marker);
});
check("asset adapter has no shared scheduler changes", () => {
  for (const forbidden of ["generation-orchestrator", "workbench-data-bridge", "browser-controller", "infinite-canvas", "task-center", "model-gateway"]) assert(!source.includes(forbidden), forbidden);
});
check("asset library styles exist", () => {
  for (const marker of ["text-assets-library", "text-asset-card", "text-asset-drop-target", "text-asset-insert-editor"]) assert(css.includes(marker), marker);
});

const failed = checks.filter(item => !item.ok);
const result = {test:"text-workspace-assets", total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-workspace-assets.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
