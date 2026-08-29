"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "src", "main", "browser-controller.cjs"), "utf8");
const checks = [];

function check(name, ok, detail = "") {
  checks.push({name, ok: Boolean(ok), detail});
}

check("window starts maximized", source.includes('"--start-maximized"'), "large layouts expose more controls");
check("minimum desktop viewport is requested", source.includes('"--window-size=1280,900"'), "consistent starting viewport");
check("login uses authenticated session cookies", source.includes("hasAuthenticatedSession") && source.includes("sessionid_ss"), "layout-independent login evidence");
check("nickname has account avatar anchor", source.includes("passport\\.byteacctimg") && source.includes("accountButton"), "avoids matching 快速/更多");
check("new task navigates to fresh chat", source.includes("prepareFreshConversation") && source.includes('Page.navigate'), "does not require visible sidebar");
check("video mode supports direct entry", source.includes("const direct") && source.includes("视频生成|生成视频"), "wide layout");
check("video mode supports compact more menu", source.includes("const more") && source.includes("已展开“更多”"), "narrow layout");
check("composer waits after navigation", source.includes("waitForComposer") && source.includes("豆包新对话页面未加载完成"), "navigation timing");
check("idle-only refresh policy exists", source.includes('session.phase !== "idle"') && source.includes("refreshPage(session)"), "never refresh submitted/generating task");
check("generation phase locks refresh", source.includes('session.phase = "generating"'), "protect submitted task scene");
check("verification phase is preserved", source.includes('session.phase = "verification"'), "manual verification does not resubmit");
check("video mode must be confirmed", source.includes("点击后未确认进入豆包视频生成模式"), "fail closed instead of normal chat");

const failed = checks.filter(item => !item.ok);
const result = {test: "responsive-doubao-layout", timestamp: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.map(item => item.name), checks};
const logDir = path.join(root, "tests", "log");
fs.mkdirSync(logDir, {recursive: true});
fs.writeFileSync(path.join(logDir, "responsive-doubao-layout.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (failed.length) process.exit(1);
