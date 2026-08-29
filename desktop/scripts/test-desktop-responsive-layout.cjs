"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "src", "renderer", "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "src", "renderer", "styles", "desktop-responsive.css"), "utf8");
const panels = fs.readFileSync(path.join(root, "src", "renderer", "sidebar-toggle.js"), "utf8");
const textLayout = fs.readFileSync(path.join(root, "src", "renderer", "text-workspace-layout.js"), "utf8");
const results = [];
const check = (name, fn) => { try { fn(); results.push({name, ok:true}); } catch (error) { results.push({name, ok:false, error:String(error.message || error)}); } };

check("全局响应式样式最后加载", () => assert(html.indexOf("desktop-responsive.css") > html.indexOf("auth.css")));
check("四档桌面布局齐全", () => ["spacious", "standard", "compact", "minimal"].forEach(mode => assert(css.includes(`[data-layout=\"${mode}\"]`), mode)));
check("紧凑导航先于主工作区收缩", () => { assert(css.includes("--shell-left-width: 82px")); assert(css.includes("--shell-left-width: 76px")); assert(css.includes("font-size: 0")); });
check("最小窗口右栏按需并排展开", () => { assert(css.includes(".shell[data-layout=\"minimal\"]:not(.right-off) > .right")); assert(css.includes("minmax(0, 1fr) 264px")); assert(panels.includes("forcedRightOpen")); });
check("任务中心按容器宽度响应", () => { assert(css.includes(".workspace:has(.task-center-layout) { container-type: inline-size; }")); assert(css.includes("@container (max-width: 1190px)")); });
check("文本工作区按实际可用宽度收栏", () => { assert(textLayout.includes("workspace.getBoundingClientRect().width")); assert(textLayout.includes("availableWidth <= 1190")); assert(css.includes(".text-workspace.is-narrow")); });
check("减少动效偏好受到保护", () => assert(css.includes("prefers-reduced-motion: reduce")));

const failed = results.filter(item => !item.ok);
const report = {test:"desktop-responsive-layout", total:results.length, passed:results.length-failed.length, failed:failed.length, results, generatedAt:new Date().toISOString()};
fs.mkdirSync(path.join(root, "scripts", "log"), {recursive:true});
fs.writeFileSync(path.join(root, "scripts", "log", "desktop-responsive-layout.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
