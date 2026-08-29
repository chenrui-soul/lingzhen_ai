"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-responsive-layout-ground-truth.json"), "utf8"));
const html = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const logic = fs.readFileSync(path.join(root, "src", "renderer", "app-fixes.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "renderer", "styles", "home-responsive.css"), "utf8");

const results = [];
function check(name, fn) {
  try { fn(); results.push({name, ok: true}); }
  catch (error) { results.push({name, ok: false, error: String(error.message || error)}); }
}

check("响应式样式在首页重设计之后加载", () => {
  assert(html.indexOf("home-responsive.css") > html.indexOf("home-redesign.css"));
});

check("小窗口自动收起参数且允许人工展开", () => {
  for (const marker of truth.requiredMarkers.slice(0, 3)) assert(logic.includes(marker), marker);
  assert(logic.includes(`window.innerHeight<=${truth.compactViewport.maxHeight}`));
  assert(logic.includes("composer.getBoundingClientRect().width"));
  assert(logic.includes(`availableWidth<=${truth.compactComposerMaxWidth}`));
  assert(logic.includes("aria-expanded"));
});

check("对话区保留最小高度并限制创作区占比", () => {
  assert(css.includes(`min-height: ${truth.layoutRules.minimumConversationHeight}px`));
  assert(css.includes(`min-height: ${truth.layoutRules.compactConversationHeight}px`));
  assert(css.includes(`max-height: min(${truth.layoutRules.composerMaximumPercent}%, 520px)`));
  assert(css.includes(`max-height: min(${truth.layoutRules.compactComposerMaximumPercent}%, 430px)`));
});

check("展开参数时创作区使用内部滚动", () => {
  assert(css.includes("overflow-y: auto !important"));
  assert(css.includes("overscroll-behavior: contain"));
  assert(css.includes(".is-parameters-collapsed .home-compose-fields"));
});

const failed = results.filter(item => !item.ok);
const report = {ok: failed.length === 0, generatedAt: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed, results};
fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
fs.writeFileSync(path.join(root, "scripts", "log", "home-responsive-layout.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
