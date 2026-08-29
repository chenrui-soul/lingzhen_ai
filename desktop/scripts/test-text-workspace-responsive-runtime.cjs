"use strict";

const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "text-workspace-responsive-ground-truth.json"), "utf8"));
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const WebSocketClient = globalThis.WebSocket || require("undici").WebSocket;
let spawnedElectron = null;

async function ensureRuntime() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (response.ok) return;
  } catch {}
  const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const userData = path.join(root, ".runtime-text-contract-user-data");
  fs.mkdirSync(userData, {recursive:true});
  spawnedElectron = spawn(electron, [".", `--remote-debugging-port=${port}`, "--no-sandbox"], {
    cwd: root,
    windowsHide: true,
    stdio: "ignore",
    env: {...process.env, LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1", LINGFRAME_TEST_USER_DATA:userData}
  });
  for (let i = 0; i < 60; i++) {
    await wait(250);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) return;
    } catch {}
  }
  throw new Error("隔离 Electron 响应式测试实例未启动");
}

async function connect() {
  await ensureRuntime();
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
    if (!target) await wait(250);
  }
  if (!target) throw new Error(`未找到目标页面：${targetHint} @ ${port}`);
  const socket = new WebSocketClient(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

function layoutProbe() {
  const box = selector => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, clientHeight: element.clientHeight, scrollHeight: element.scrollHeight };
  };
  const workspace = box(".workspace");
  const layout = box(".text-workspace");
  return {
    viewport: { width: innerWidth, height: innerHeight },
    workspace,
    layout,
    history: box(".text-history"),
    editor: box(".text-editor"),
    textarea: box(".text-area"),
    bottomGap: workspace && layout ? workspace.bottom - layout.bottom - parseFloat(getComputedStyle(document.querySelector(".workspace")).paddingBottom || 0) : null
  };
}

(async () => {
  const cdp = await connect();
  const savedAppearance = await cdp.evaluate("localStorage.getItem('lingframe.appearance.v1')");
  const activePage = await cdp.evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  try {
    await cdp.evaluate("location.reload(); true");
    await wait(500);
    await cdp.evaluate("document.querySelector('[data-page=\"text\"]')?.click(); true");
    await wait(250);
    if (!await cdp.evaluate("Boolean(document.querySelector('.text-area'))")) {
      await cdp.evaluate("document.querySelector('[data-text-new]')?.click(); true");
      await wait(100);
      await cdp.evaluate(`(()=>{const title=document.querySelector('[data-text-create-title]');if(!title)return false;title.value='响应式测试文档 '+Date.now();document.querySelector('[data-text-create-confirm]')?.click();return true})()`);
    }
    for (let i = 0; i < 100; i++) {
      if (await cdp.evaluate("Boolean(document.querySelector('.text-workspace') && document.querySelector('.text-area'))")) break;
      await wait(50);
    }
    const layouts = [];
    for (const viewport of truth.viewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await wait(150);
      layouts.push(await cdp.evaluate(`(${layoutProbe.toString()})()`));
    }
    const first = layouts[0], last = layouts[layouts.length - 1];
    const viewportGrowth = last.viewport.height - first.viewport.height;
    const layoutGrowth = last.layout.height - first.layout.height;
    const textareaGrowth = last.textarea.height - first.textarea.height;
    check("文本工作区随窗口高度同步增长", layoutGrowth >= viewportGrowth * truth.minimumGrowthRatio, { viewportGrowth, layoutGrowth, layouts });
    check("正文输入区吸收新增高度", textareaGrowth >= viewportGrowth * truth.minimumGrowthRatio, { viewportGrowth, textareaGrowth, layouts });
    check("文本工作区贴合可用区域底部", layouts.every(item => Math.abs(item.bottomGap) <= truth.maximumBottomGapPx), layouts);
    check("历史栏和编辑器等高", layouts.every(item => Math.abs(item.history.height - item.editor.height) <= 1), layouts);
    check("文本工作区没有纵向页面溢出", layouts.every(item => item.workspace.scrollHeight <= item.workspace.clientHeight + truth.maximumOverflowPx), layouts);
    check("正文输入区保留最小可用高度", layouts.every(item => item.textarea.height >= truth.minimumTextareaHeightPx), layouts);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const logDir = path.join(root, "scripts", "log");
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "text-workspace-responsive.png"), Buffer.from(screenshot.data, "base64"));
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await cdp.evaluate(`(()=>{const saved=${JSON.stringify(savedAppearance)};if(saved===null)localStorage.removeItem('lingframe.appearance.v1');else localStorage.setItem('lingframe.appearance.v1',saved);document.querySelector('[data-page=${JSON.stringify(activePage)}]')?.click();location.reload();return true})()`).catch(() => {});
    cdp.close();
    if (spawnedElectron) { try { spawnedElectron.kill(); } catch {} }
  }
  const failed = checks.filter(item => !item.ok);
  const report = { test: "text-workspace-responsive-runtime", timestamp: new Date().toISOString(), port, targetHint, groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, "text-workspace-responsive-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
