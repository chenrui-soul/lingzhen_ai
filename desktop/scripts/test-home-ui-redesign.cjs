"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const app = read("src/renderer/app.js");
const index = read("src/renderer/index.html");
const homeCss = read("src/renderer/styles/home-redesign.css");
const appFixes = read("src/renderer/app-fixes.js");
const conversations = read("src/renderer/home-conversations.js");
const generation = read("src/renderer/generation-ui.js");
const generationCss = read("src/renderer/styles/generation-ui.css");
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

check("home removes unused AI assistant copy", !app.includes("AI创作助手"));
check("home removes static fake task cards", !app.includes("mini-task"));
check("right rail is reserved for real tasks", app.includes('aria-label="实时任务"'));
check("home title is explicit", app.includes("title:'创作首页'"));
check(
  "home redesign stylesheet loads last",
  index.indexOf("home-redesign.css") > index.indexOf("home-conversations.css"),
);
check("home uses calmer two-column workflow grid", homeCss.includes("grid-template-columns: repeat(2, minmax(220px, 1fr))"));
check("home prompt text is readable", /home-prompt-editor textarea[\s\S]*font-size:\s*15px/.test(homeCss));
check("prompt textarea node is preserved inside editor", appFixes.includes("appendChild(input)"));
check("prompt editor exposes character count", appFixes.includes("data-home-prompt-count") && appFixes.includes("toLocaleString('zh-CN')"));
check("prompt editor supports expand and collapse", appFixes.includes("data-home-prompt-toggle") && appFixes.includes("is-expanded"));
check("prompt editor supports clearing content", appFixes.includes("data-home-prompt-clear") && appFixes.includes("input.value=''"));
check("prompt editor auto grows with content", appFixes.includes("Math.min(input.scrollHeight,maxHeight)"));
check("restored drafts refresh prompt editor", conversations.includes("lingframe:prompt-value-changed"));
check("prompt editor has keyboard focus treatment", homeCss.includes("button:focus-visible") && homeCss.includes(".home-prompt-editor.is-focused"));
check("home field labels are at least 11px", /home-compose-fields label[\s\S]*font-size:\s*11px/.test(homeCss));
check("home message body is at least 14px", /home-chat-bubble p[\s\S]*font-size:\s*14px/.test(homeCss));
check("long conversation content collapses by default", conversations.includes("content.split(/\\r?\\n/).length>7") && conversations.includes("is-collapsed"));
check("conversation content can expand and collapse", conversations.includes("data-home-chat-toggle") && conversations.includes("收起内容"));
check("wide screens use more of the conversation area", homeCss.includes("max-width: min(1180px, 90%)"));
check("asset preview and selection use separate controls", appFixes.includes("⌕ 预览大图") && appFixes.includes("选择素材") && appFixes.includes("aria-pressed"));
check("asset picker explains the two actions", appFixes.includes("点击图片只预览") && appFixes.includes("图片区域用于预览"));
check("task dock fills the real right rail", generation.includes("shell.style.top=") && generation.includes("shell.style.height="));
check("task dock has a real empty state", generation.includes("if(!tasks.length)renderLiveDock(ensureLiveShell())"));
check("task dock does not cover canvas inspector", generation.includes(':not([data-current-page="canvas"])'));
check("task dock title is readable", /generation-live-title > b[\s\S]*font-size:\s*15px/.test(generationCss));
check("task dock status is readable", /generation-live-status[\s\S]*font-size:\s*11px/.test(generationCss));

try {
  new vm.Script(app, { filename: "app.js" });
  new vm.Script(generation, { filename: "generation-ui.js" });
  check("renderer syntax", true);
} catch (error) {
  check("renderer syntax", false, error.message);
}

const failed = checks.filter(item => !item.ok);
console.log(JSON.stringify({
  test: "home-ui-redesign",
  total: checks.length,
  passed: checks.length - failed.length,
  failed: failed.length,
  checks,
}, null, 2));

if (failed.length) process.exit(1);
