"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "embedded-browser-ground-truth.json"), "utf8"));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const manager = read("src/main/embedded-browser-manager.cjs");
const main = read("src/main/main.cjs");
const preload = read("src/preload/preload.cjs");
const renderer = read("src/renderer/app.js");
const ui = read("src/renderer/desktop-ui.js");
const controller = read("src/main/browser-controller.cjs");
const orchestrator = read("src/main/generation-orchestrator.cjs");
const checks = [];
const check = (name, ok, detail="") => checks.push({name, ok:Boolean(ok), detail});
check("ground truth has two accounts", truth.accounts.length === 2);
check("manager uses account BrowserWindow", manager.includes("new BrowserWindow") && manager.includes("browserWindowFactory"));
check("legacy single WebContentsView removed", !manager.includes("WebContentsView") && !manager.includes("hideAll()"));
check("manager uses persistent partition", manager.includes("persist:lingframe_"));
check("partition contains tenant and account", manager.includes("safePart(tenant)") && manager.includes("this.accountId(account)"));
check("partitions differ by account", truth.accounts[0].expectedPartition !== truth.accounts[1].expectedPartition);
check("safe default viewport", Object.entries(truth.safeWindow).every(([key,value]) => manager.includes(`${key}: ${value}`)));
check("background timers are not throttled", manager.includes("backgroundThrottling: false"));
check("floating window is movable and resizable", manager.includes("movable: true") && manager.includes("resizable: true"));
check("running task close is protected", /worker\.on\("close"[\s\S]*?activeTaskIds\.size[\s\S]*?event\.preventDefault\(\)[\s\S]*?worker\.hide\(\)/.test(manager));
check("task lifecycle is account bound", manager.includes("async beginTask(account, task") && manager.includes("updateTask(task") && manager.includes("finishTask(accountId"));
check("terminal task releases floating window without destroying profile", /TERMINAL_TASK_STATES\.has\(task\.state\)[\s\S]*?!item\.activeTaskIds\.size[\s\S]*?item\.window\.hide\(\)/.test(manager) && /finishTask\(accountId[\s\S]*?!item\.activeTaskIds\.size[\s\S]*?item\.window\.hide\(\)/.test(manager));
check("main layout bounds are ignored", manager.includes('mode: "floating-window"') && manager.includes("ignored: true"));
check("automation opens same account runtime", controller.includes("automationSession(account)") && controller.includes("webContents: item.webContents") && controller.includes("window: item.window"));
check("stale embedded runtime is rejected", controller.includes("!current.webContents.isDestroyed()") && controller.includes("current.cdp?.close()"));
check("orchestrator starts and synchronizes runtime", orchestrator.includes("beginBrowserTask(task)") && orchestrator.includes("syncBrowserTask(value)"));
check("open route refreshes verified identity", /ipcMain\.handle\('doubao:open',[\s\S]*?desktopIdentity\.bootstrap\(\)/.test(main));
check("hide route is exposed", main.includes("doubao:hide-account") && preload.includes("hideAccount"));
check("renderer explains floating worker", renderer.includes("独立豆包任务窗口") && renderer.includes("切换工作台模块不会改变豆包 DOM"));
check("renderer no longer sends live DOM bounds", !/function updateEmbeddedBounds\(\) \{[\s\S]*?api\.doubao\.setBounds/.test(ui));
check("account card click only selects without opening", /const actionButton = event\.target\.closest\('\[data-account-action\]'\);[\s\S]*?document\.querySelectorAll\('\.account-compact'\)[\s\S]*?if \(!actionButton\) return;[\s\S]*?const action = actionButton\.dataset\.accountAction;/.test(ui) && !ui.includes("const action = actionButton?.dataset.accountAction || 'open';"));
check("create and open uses explicit open button", ui.includes("querySelector('[data-account-action=\"open\"]')?.click()"));
check("network capture remains job-bound", controller.includes('source: "embedded-network"') && controller.includes("jobId: session.currentJobId"));
for (const file of ["src/main/embedded-browser-manager.cjs","src/main/browser-controller.cjs","src/main/generation-orchestrator.cjs","src/main/main.cjs","src/preload/preload.cjs","src/renderer/app.js","src/renderer/desktop-ui.js"]) {
  try { new vm.Script(read(file), {filename:file}); check(`syntax ${file}`, true); }
  catch (error) { check(`syntax ${file}`, false, error.message); }
}
const failed = checks.filter(item => !item.ok);
const result = {test:"per-account-floating-browser", timestamp:new Date().toISOString(), groundTruth:truth, total:checks.length, passed:checks.length-failed.length, failed:failed.map(item=>item.name), checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "embedded-browser-manager.json"), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2)); if (failed.length) process.exit(1);
