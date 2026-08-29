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
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); }
};
const includesAll = (source, values) => values.forEach(value => assert(source.includes(value), `缺少 ${value}`));

check("S3 remains inside the project resource renderer surface", () => {
  assert.equal(hash("src/renderer/app.js"), "BE1C3F957BDAD467C72D0162F00E1601729D3AF8745F0F502AA385B993D178AC");
});
check("rerendered controls restore keyboard focus", () => includesAll(renderer, [
  "function rerenderAndFocus", "data-resource-mode", "data-project-status", "data-resource-project", "data-asset-search", "data-asset-project", "data-asset-status", "data-asset-type", "data-select-doubao-asset", "data-select-visible-doubao"
]));
check("segmented controls expose programmatic pressed state", () => includesAll(renderer, [
  "applyResourceAccessibility", "aria-pressed", "按项目状态筛选", "按素材类型筛选", "资源视图"
]));
check("project filters expose current selection", () => includesAll(renderer, [
  "data-resource-project", "aria-current", "removeAttribute(\"aria-current\")"
]));
check("asset preview has a specific accessible name", () => includesAll(renderer, [
  "data-asset-action=\"preview\"", "预览素材："
]));
check("collapsible project panel exposes its controlled region", () => includesAll(renderer, [
  "resource-project-rail-body", "aria-controls", "aria-expanded"
]));
check("dialogs expose role modal title and description semantics", () => includesAll(renderer, [
  "role=\"dialog\"", "aria-modal=\"true\"", "aria-labelledby", "aria-describedby", "关闭对话框"
]));
check("dialog keyboard lifecycle supports escape and tab trapping", () => includesAll(renderer, [
  "event.key===\"Escape\"", "event.key!==\"Tab\"", "event.shiftKey", "focusableSelector"
]));
check("dialog close restores the invoking control", () => includesAll(renderer, [
  "returnFocus=document.activeElement", "returnFocus.isConnected", "returnFocus.focus({preventScroll:true})"
]));
check("confirm dialog resolves dismiss and escape as false", () => includesAll(renderer, [
  "onClose:reason", "resolve(reason===\"confirm\")", "host.closeModal(\"confirm\")"
]));
check("all modal workflows use the common close lifecycle", () => {
  assert.equal((renderer.match(/host\.remove\(\)/g) || []).length, 1, "只允许 closeModal 内部执行一次 host.remove()");
  includesAll(renderer, ["host.closeModal(\"complete\")", "host.closeModal(\"complete\",false)"]);
});
check("toast messages are announced with suitable urgency", () => includesAll(renderer, [
  "role\",error?\"alert\":\"status", "aria-live", "assertive", "polite", "aria-atomic"
]));
check("focus indication is visible in resource and modal controls", () => includesAll(css, [
  "S3: keyboard, focus and assistive-technology refinement", ":focus-visible", "outline:2px solid #75e8ff", ".pm-dialog[role=\"dialog\"]"
]));
check("reduced motion and forced colors are respected", () => includesAll(css, [
  "prefers-reduced-motion:reduce", "animation-duration:.01ms!important", "forced-colors:active", "Highlight", "CanvasText"
]));
check("doubao selection and copy controls remain intact", () => includesAll(renderer, [
  "data-select-doubao-asset", "data-select-visible-doubao", "data-copy-doubao-links", "data-copy-doubao-url", "resultVid"
]));
check("result recovery still scrolls without regenerating", () => {
  includesAll(renderer, ["lingframe:generation-status", "pendingResultAssetId", "prefers-reduced-motion: reduce"]);
  assert(!renderer.includes("generation.create("), "项目资源库不得在结果恢复时重新生成");
});

const failed = checks.filter(item => !item.ok);
const result = {
  test:"project-resource-accessibility-s3",
  timestamp:new Date().toISOString(),
  total:checks.length,
  passed:checks.length - failed.length,
  failed:failed.length,
  failures:failed,
  checks
};
const logRoot = path.join(root, "scripts", "log");
fs.mkdirSync(logRoot, {recursive:true});
fs.writeFileSync(path.join(logRoot, "project-resource-accessibility-s3.json"), JSON.stringify(result, null, 2));
process.stdout.write(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
