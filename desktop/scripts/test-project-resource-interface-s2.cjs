"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const renderer = read("src/renderer/project-materials.js");
const css = read("src/renderer/styles/project-materials.css");
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); }
};
const includesAll = (source, values) => values.forEach(value => assert(source.includes(value), `缺少 ${value}`));

check("resource library keeps the unified renderer contract", () => includesAll(renderer, ["renderResourceLibrary", "resourceMode:\"assets\"", "resourceAssetsPanel", "resourceProjectsPanel"]));
check("resource mode summary exposes asset project and doubao counts", () => includesAll(renderer, ["resource-mode-summary", "个可用素材", "个有效项目", "条豆包结果链接"]));
check("asset toolbar separates primary filters from secondary actions", () => includesAll(renderer, ["resource-toolbar-primary", "resource-toolbar-secondary", "resource-result-count", "resource-batch-actions"]));
check("search project status and type controls remain bound", () => includesAll(renderer, ["data-asset-search", "data-asset-project", "data-asset-status", "data-asset-type=\"image\"", "bindMaterials(workspace,renderResourceLibrary)"]));
check("doubao select and batch copy controls remain bound", () => includesAll(renderer, ["data-select-visible-doubao", "data-select-doubao-asset", "data-copy-doubao-links", "data-copy-doubao-url"]));
check("removed safety panel is not restored", () => {
  for (const marker of ["resourceSafetyOpen", "data-resource-safety-toggle", "resource-safety-body", "归属与安全"]) assert(!renderer.includes(marker), marker);
});
check("project rail starts useful and remains collapsible", () => includesAll(renderer, ["resourceProjectRailOpen:true", "data-resource-rail-toggle", "resource-project-rail-body", "data-project-status", "data-resource-project=\"all\"", "data-project-action"]));
check("drop zone preserves upload order and project ownership evidence", () => includesAll(renderer, ["resource-drop-copy", "resource-drop-project", "上传顺序、原文件名和项目归属保持不变", "data-asset-drop"]));
check("responsive layout uses workspace container width", () => includesAll(css, [".workspace:has(.resource-library){container-type:inline-size}", "@container (max-width:800px)", "@container (max-width:600px)", "@container (max-width:500px)"]));
check("common desktop widths keep project rail and content aligned", () => includesAll(css, ["grid-template-columns:minmax(220px,240px) minmax(0,1fr)", ".resource-project-rail{grid-column:1;grid-row:1", ".resource-content{grid-column:2;grid-row:1"]));
check("narrow widths collapse the project rail but keep expansion", () => includesAll(css, [".resource-project-rail-body{display:none}", ".resource-project-rail.expanded .resource-project-rail-body{display:block}", ".resource-project-rail-summary em{display:block}"]));
check("asset grid retains useful density across desktop widths", () => includesAll(css, ["grid-template-columns:repeat(auto-fill,minmax(180px,1fr))", "minmax(180px,200px) minmax(340px,1fr)"]));
check("toolbar controls keep readable hit areas", () => includesAll(css, ["height:36px;font-size:10px", "min-height:29px;height:29px", ".resource-batch-actions .ghost{height:32px"]));
check("long project names and result URLs retain overflow protection", () => includesAll(css, ["overflow:hidden;text-overflow:ellipsis;white-space:nowrap", "overflow-wrap:anywhere"]));
check("legacy standalone navigation is not restored", () => {
  assert(!renderer.includes("恢复旧双入口"));
  assert(!renderer.includes("data-resource-legacy"));
});

const failed = checks.filter(item => !item.ok);
const result = {
  test:"project-resource-interface-s2",
  timestamp:new Date().toISOString(),
  total:checks.length,
  passed:checks.length - failed.length,
  failed:failed.length,
  failures:failed,
  checks
};
const logRoot = path.join(root, "scripts", "log");
fs.mkdirSync(logRoot, {recursive:true});
fs.writeFileSync(path.join(logRoot, "project-resource-interface-s2.json"), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
