"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const layout = read("src/renderer/text-workspace-layout.js");
const css = read("src/renderer/styles/text-workspace.css");
const responsive = read("src/renderer/styles/text-workspace-responsive.css");
const desktopResponsive = read("src/renderer/styles/desktop-responsive.css");
const index = read("src/renderer/index.html");
const checks = [];

function check(name, fn) {
  try { fn(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.message || error)}); }
}

check("layout script loads after text workspace", () => {
  assert(index.indexOf("./text-workspace.js") >= 0);
  assert(index.indexOf("./text-workspace-layout.js") > index.indexOf("./text-workspace.js"));
});
check("three-column grid contract", () => {
  for (const marker of ["--text-left-width", "--text-right-width", "text-layout-splitter", "text-assist"]) assert(css.includes(marker), marker);
  assert(css.includes("minmax(0,1fr)"));
});
check("width boundaries", () => {
  for (const marker of ["leftMin: 220", "leftMax: 420", "rightMin: 320", "rightMax: 620"]) assert(layout.includes(marker), marker);
});
check("drag and reset interactions", () => {
  for (const marker of ["pointerdown", "pointermove", "dblclick", "ArrowLeft", "ArrowRight", "Home"]) assert(layout.includes(marker), marker);
});
check("collapse and expand interactions", () => {
  for (const marker of ["leftCollapsed", "rightCollapsed", "data-text-layout-toggle", "is-left-collapsed", "is-right-collapsed"]) assert(layout.includes(marker) || css.includes(marker), marker);
});
check("project and tenant scoped persistence", () => {
  for (const marker of ["lingframe.textWorkspaceLayout.v1", "identity?.status", "projectIdOf", "localStorage.setItem", "localStorage.getItem"]) assert(layout.includes(marker), marker);
});
check("narrow workspace collapses rails by available content width", () => {
  for (const marker of ["workspace.getBoundingClientRect().width || window.innerWidth", "availableWidth <= 1040", "classList.toggle(\"is-narrow\", narrow)"]) assert(layout.includes(marker), marker);
  assert(responsive.includes(".text-workspace.is-narrow"));
  assert(desktopResponsive.includes(".shell:has(.text-workspace) .text-workspace.is-narrow"));
  assert(desktopResponsive.includes("46px 6px minmax(0, 1fr) 6px 46px"));
});
check("no shared module references", () => {
  for (const forbidden of ["generation-orchestrator", "workbench-data-bridge", "browser-controller", "infinite-canvas", "task-center"]) assert(!layout.includes(forbidden), forbidden);
});
check("assistant panel keeps future model panel boundary", () => {
  assert(layout.includes("模型与参数"));
  assert(layout.includes("批次 C"));
});

const failed = checks.filter(item => !item.ok);
const result = {test: "text-workspace-layout", total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive: true});
fs.writeFileSync(path.join(logDir, "text-workspace-layout.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
