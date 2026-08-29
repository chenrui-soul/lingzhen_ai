"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const browserPath = path.join(root, "src", "main", "browser-controller.cjs");
const referencePath = path.join(root, "references", "doubao-fast-model-menu-ground-truth.json");
const browserSource = fs.readFileSync(browserPath, "utf8");
const checks = [];
const check = (name, ok, detail = null) => checks.push({name, ok: Boolean(ok), detail});
const normalize = value => String(value || "").replace(/\s+/g, "").toLowerCase();

function generateGroundTruth() {
  const truth = {
    targetModel: "Seedance 2.0 Fast",
    alternateModel: "Seedance 2.0 Mini",
    modelMenuItemSelectors: ["[role=\"menuitem\"]", "[role=\"option\"]", "[data-radix-collection-item]"],
    maxAttempts: 3,
    scenarios: [
      {name: "菜单已经展开", initialMenuOpen: true, targetModel: "Seedance 2.0 Fast", failedClicksBeforeSelect: 0, confirmedControlText: "Seedance 2.0 Fast", expectedModelControlClicks: 0, expectedModelItemClicks: 1, expectedEscapePresses: 0},
      {name: "菜单尚未展开", initialMenuOpen: false, targetModel: "Seedance 2.0 Fast", failedClicksBeforeSelect: 0, confirmedControlText: "Seedance 2.0 Fast", expectedModelControlClicks: 1, expectedModelItemClicks: 1, expectedEscapePresses: 0},
      {name: "首次点击未生效后重试", initialMenuOpen: false, targetModel: "Seedance 2.0 Fast", failedClicksBeforeSelect: 1, confirmedControlText: "Seedance 2.0 Fast", expectedModelControlClicks: 2, expectedModelItemClicks: 2, expectedEscapePresses: 1},
      {name: "控制器文字换行", initialMenuOpen: false, targetModel: "Seedance 2.0 Fast", failedClicksBeforeSelect: 0, confirmedControlText: "Seedance 2.0\n  Fast", expectedModelControlClicks: 1, expectedModelItemClicks: 1, expectedEscapePresses: 0},
      {name: "Mini 原有切换", initialMenuOpen: false, targetModel: "Seedance 2.0 Mini", failedClicksBeforeSelect: 0, confirmedControlText: "Seedance 2.0 Mini", initialSelectedModel: "Seedance 2.0 Fast", expectedModelControlClicks: 1, expectedModelItemClicks: 1, expectedEscapePresses: 0}
    ],
    failureScenario: {name: "连续三次点击均未生效", initialMenuOpen: false, targetModel: "Seedance 2.0 Fast", failedClicksBeforeSelect: 99, expectedModelControlClicks: 3, expectedModelItemClicks: 3, expectedEscapePresses: 2}
  };
  fs.mkdirSync(path.dirname(referencePath), {recursive: true});
  fs.writeFileSync(referencePath, JSON.stringify(truth, null, 2) + "\n", "utf8");
  return truth;
}

async function runScenario(BrowserController, scenario) {
  let menuOpen = Boolean(scenario.initialMenuOpen);
  let selectedModel = scenario.initialSelectedModel || (scenario.targetModel.endsWith("Fast") ? "Seedance 2.0 Mini" : "Seedance 2.0 Fast");
  let modelControlClicks = 0;
  let modelItemClicks = 0;
  let escapePresses = 0;
  let parameterPanelTouched = false;
  let composerTouched = false;
  const controller = new BrowserController({profileRootProvider: () => root, downloadRootProvider: () => root, testMode: false});
  controller.evaluate = async (_session, expression) => {
    if (/fillComposer|submitComposer|doubao-submit/.test(expression)) composerTouched = true;
    if (expression.includes("doubao-model-control")) return {x: 100, y: 100, selected: normalize(selectedModel) === normalize(scenario.targetModel), text: selectedModel};
    if (expression.includes("doubao-model-menu-item")) return menuOpen ? {x: 200, y: 100, text: scenario.targetModel.replace(" ", "\n")} : false;
    if (expression.includes("doubao-model-menu-open")) return menuOpen;
    if (expression.includes("doubao-model-verified")) return normalize(selectedModel) === normalize(scenario.targetModel);
    if (expression.includes("doubao-model-diagnostic")) return {target: scenario.targetModel, attempts: 3, controls: [{text: selectedModel}], menus: [], items: []};
    if (expression.includes("const model=") && expression.includes("paramsControl")) return {model: true, ratio: true, duration: true};
    if (expression.includes("input[type=\"range\"]") || expression.includes("input[type='range']")) return {method: "native"};
    if (expression.includes("[role=\"radio\"]") || expression.includes("[role='radio']")) return {x: 300, y: 300, text: "16:9"};
    if (expression.includes("video-generation-params-panel")) { parameterPanelTouched = true; return {x: 400, y: 100, text: "16:9 · 10s"}; }
    throw new Error(`未覆盖的页面表达式：${expression.slice(0, 160)}`);
  };
  controller.connect = async () => ({send: async (method, params = {}) => {
    if (method === "Input.dispatchKeyEvent" && params.type === "rawKeyDown" && params.key === "Escape") { escapePresses += 1; menuOpen = false; return {}; }
    if (method !== "Input.dispatchMouseEvent" || params.type !== "mouseReleased") return {};
    if (params.x === 100) { modelControlClicks += 1; menuOpen = !menuOpen; }
    if (params.x === 200 && menuOpen) {
      modelItemClicks += 1;
      if (modelItemClicks > scenario.failedClicksBeforeSelect) selectedModel = scenario.confirmedControlText || scenario.targetModel;
      menuOpen = false;
    }
    return {};
  }});
  let result = null;
  let error = null;
  try {
    result = await controller.setVideoParameters({testMode: false, modelSelectionVerificationTimeoutMs: 60}, {doubaoModel: scenario.targetModel, ratio: "16:9", duration: "10s"});
  } catch (caught) {
    error = caught;
  }
  return {result, error, selectedModel, modelControlClicks, modelItemClicks, escapePresses, parameterPanelTouched, composerTouched};
}

(async () => {
  const truth = generateGroundTruth();
  const modelBlock = browserSource.slice(browserSource.indexOf("async setVideoParameters"), browserSource.indexOf("const panelControl", browserSource.indexOf("async setVideoParameters")));
  const sourceContract = truth.modelMenuItemSelectors.every(selector => modelBlock.includes(selector))
    && modelBlock.includes("const maxAttempts=3")
    && modelBlock.includes("doubao-model-diagnostic")
    && modelBlock.includes("replace(/\\\\s+/g,'')")
    && modelBlock.includes("Input.dispatchKeyEvent");
  check("模型选择具备多选择器、文字归一化、三次重试和诊断", sourceContract, {selectors: truth.modelMenuItemSelectors, maxAttempts: truth.maxAttempts});

  delete require.cache[require.resolve(browserPath)];
  const {BrowserController, normalizeVideoParameters} = require(browserPath);
  check("Fast 参数原样进入豆包执行层", normalizeVideoParameters({doubaoModel: truth.targetModel}).model === truth.targetModel);
  check("Mini 参数原样进入豆包执行层", normalizeVideoParameters({doubaoModel: truth.alternateModel}).model === truth.alternateModel);

  for (const scenario of truth.scenarios) {
    const observed = await runScenario(BrowserController, scenario);
    check(`${scenario.name}时正确确认模型`, !observed.error && normalize(observed.selectedModel) === normalize(scenario.targetModel) && observed.result?.model === scenario.targetModel, observed);
    check(`${scenario.name}时重试次数正确`, observed.modelControlClicks === scenario.expectedModelControlClicks && observed.modelItemClicks === scenario.expectedModelItemClicks && observed.escapePresses === scenario.expectedEscapePresses, observed);
    check(`${scenario.name}时未触碰提示词与提交`, observed.composerTouched === false, observed);
  }

  const failedSelection = await runScenario(BrowserController, truth.failureScenario);
  check("连续失败三次后返回带诊断的确认错误", Boolean(failedSelection.error) && /豆包视频模型确认失败/.test(failedSelection.error.message) && /\"attempts\":3/.test(failedSelection.error.message), failedSelection);
  check("连续失败严格限制为三次并关闭残留菜单", failedSelection.modelControlClicks === truth.failureScenario.expectedModelControlClicks && failedSelection.modelItemClicks === truth.failureScenario.expectedModelItemClicks && failedSelection.escapePresses === truth.failureScenario.expectedEscapePresses, failedSelection);
  check("模型确认失败前不进入后续参数或提示词阶段", failedSelection.parameterPanelTouched === false && failedSelection.composerTouched === false, failedSelection);

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-fast-model-menu", timestamp: new Date().toISOString(), groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
  fs.writeFileSync(path.join(root, "scripts", "log", "doubao-fast-model-menu.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
