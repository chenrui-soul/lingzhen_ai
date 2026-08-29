"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-conversations-phase1-ground-truth.json"), "utf8"));
const scriptFile = path.join(root, "src", "renderer", "home-conversations.js");
const styleFile = path.join(root, "src", "renderer", "styles", "home-conversations.css");
const htmlFile = path.join(root, "src", "renderer", "index.html");
const source = fs.readFileSync(scriptFile, "utf8");
const css = fs.readFileSync(styleFile, "utf8");
const html = fs.readFileSync(htmlFile, "utf8");
const checks = [];
const check = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });

try { new vm.Script(source); check("home conversation script syntax", true); }
catch (error) { check("home conversation script syntax", false, error.message); }
check("conversation stylesheet is loaded", html.includes('./styles/home-conversations.css'));
check("conversation script is loaded after app fixes", html.indexOf('./home-conversations.js') > html.indexOf('./app-fixes.js'));
check("tenant and project scoped storage", source.includes(truth.storagePrefix) && source.includes('tenantId') && source.includes('projectId'));
check("new conversation is implemented", source.includes('function createConversation()') && source.includes('data-home-chat-new'));
check("draft persistence is implemented", source.includes('homeChatDraftBound') && source.includes('conversation.draft = input.value'));
check("rename conversation is implemented", source.includes('function renameConversation(id)'));
check("delete conversation is implemented", source.includes('function deleteConversation(id)'));
check("input records are implemented", source.includes('function recordInput(composer)') && source.includes("role: 'user'"));
check("history search is implemented", source.includes('data-home-chat-search') && source.includes('runtime.query'));
check("existing composer is moved rather than rebuilt", source.includes("main.appendChild(composer)") && !source.includes("composer.innerHTML"));
check("composer listeners recover after asynchronous home rerender", source.includes("!input.dataset.homeChatDraftBound") && source.includes("bindComposer(existingComposer)"));
check("no backend mutation was added", truth.forbiddenBackendCalls.every(token => !source.includes(token)), truth.forbiddenBackendCalls.filter(token => source.includes(token)));
check("responsive layout exists", css.includes('@media(max-width:1250px)') && css.includes('@media(max-width:950px)'));
check("theme semantic colors are used", css.includes('var(--appearance-text)') && css.includes('var(--appearance-surface)'));

const failed = checks.filter(item => !item.ok);
const report = { test: "home-conversations-phase1-static", timestamp: new Date().toISOString(), groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, { recursive: true });
fs.writeFileSync(path.join(logDir, "home-conversations-phase1-static.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
if (failed.length) process.exitCode = 1;
