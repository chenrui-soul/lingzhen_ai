"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const browserPath = path.join(root, "src", "main", "browser-controller.cjs");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "doubao-video-mode-entry-ground-truth.json"), "utf8"));
const source = fs.readFileSync(browserPath, "utf8");
const {BrowserController} = require(browserPath);
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.message || error)}); }
};

async function runScenario(scenario) {
  const controller = new BrowserController({profileRootProvider: () => root, testMode: false});
  let clicks = 0;
  let escapePresses = 0;
  controller.evaluate = async (_session, expression) => {
    if (expression.includes("doubao-video-mode-state")) {
      const index = Math.min(clicks, scenario.initialStates.length - 1);
      return scenario.initialStates[index];
    }
    if (expression.includes("doubao-video-entry-target")) return scenario.entry || false;
    if (expression.includes("doubao-video-more-target")) return false;
    if (expression.includes("doubao-video-mode-diagnostic")) return {url: "https://www.doubao.com/chat", placeholder: "发消息或按住空格说话..."};
    throw new Error(`未覆盖的页面表达式：${expression.slice(0, 120)}`);
  };
  controller.connect = async () => ({send: async (method, params = {}) => {
    if (method === "Input.dispatchKeyEvent" && params.type === "rawKeyDown" && params.key === "Escape") escapePresses += 1;
    if (method === "Input.dispatchMouseEvent" && params.type === "mouseReleased") clicks += 1;
    return {};
  }});
  let error = null;
  try { await controller.ensureVideoMode({testMode: false, videoModeConfirmTimeoutMs: 30}); }
  catch (caught) { error = caught; }
  return {error, clicks, escapePresses};
}

(async () => {
  check("视频模式使用多证据确认", () => {
    assert(source.includes("doubao-video-mode-state"));
    assert(source.includes("videoComposer"));
    assert(source.includes("Boolean(model||params||composer)"));
  });
  check("入口限定在输入区工具栏并校验实际命中元素", () => {
    assert(source.includes("doubao-video-entry-target"));
    assert(source.includes("composer-toolbar"));
    assert(source.includes("document.elementFromPoint"));
  });
  check("切换前清理浮层且最多尝试两次", () => {
    assert(source.includes("const maxAttempts=2"));
    assert(source.includes("Input.dispatchKeyEvent"));
  });

  for (const scenario of truth.scenarios) {
    const observed = await runScenario(scenario);
    check(`${scenario.name}能够进入视频模式`, () => assert.equal(observed.error, null));
    check(`${scenario.name}点击次数符合 Ground Truth`, () => assert.equal(observed.clicks, scenario.expectedClicks));
    check(`${scenario.name}浮层清理次数符合 Ground Truth`, () => assert.equal(observed.escapePresses, scenario.expectedEscapePresses));
  }

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-video-mode-entry", timestamp: new Date().toISOString(), groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, "doubao-video-mode-entry.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
