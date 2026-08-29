"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "infinite-canvas-responsive-ground-truth.json"), "utf8"));
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop");
const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
  if (!target) throw new Error(`未找到目标页面：${targetHint} @ ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 10000);
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
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
    return {
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth
    };
  };
  const workspace = box(".shell.lfc-page-active .workspace");
  const stage = box(".lfc-stage");
  return {
    viewport: { width: innerWidth, height: innerHeight },
    workspace,
    stage,
    bottomGap: workspace && stage ? workspace.bottom - stage.bottom : null,
    left: box(".lfc-library"),
    right: box(".lfc-inspector")
  };
}

function fontProbe() {
  const font = selector => {
    const element = document.querySelector(selector);
    return element ? parseFloat(getComputedStyle(element).fontSize) : null;
  };
  return {
    leftTitle: font(".lfc-library-head strong"),
    leftItem: font(".lfc-library-node strong"),
    leftSubtitle: font(".lfc-library-node small"),
    rightTitle: font(".lfc-inspector-head strong"),
    rightSubtitle: font(".lfc-inspector-head small"),
    rightTab: font(".lfc-inspector-tabs button span"),
    nodeTitle: font(".lfc-node-head strong")
  };
}

(async () => {
  const cdp = await connect();
  const savedAppearance = await cdp.evaluate("localStorage.getItem('lingframe.appearance.v1')");
  const activePage = await cdp.evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  let savedCanvasPanels = null;
  try {
    await cdp.evaluate("location.reload(); true");
    await wait(500);
    await cdp.evaluate("document.querySelector('[data-page=\"canvas\"]')?.click(); true");
    for (let i = 0; i < 100; i++) {
      if (await cdp.evaluate("Boolean(document.querySelector('.lfc-stage') && document.querySelector('.lfc-inspector'))")) break;
      await wait(50);
    }
    savedCanvasPanels = await cdp.evaluate(`({
      leftCollapsed: document.querySelector('.lfc-stage')?.classList.contains('left-collapsed') === true,
      inspectorCollapsed: document.querySelector('.shell')?.classList.contains('lfc-inspector-collapsed') === true
    })`);
    await cdp.evaluate(`(()=>{
      if(document.querySelector('.lfc-stage')?.classList.contains('left-collapsed')) document.querySelector('[data-lfc-toggle-left]')?.click();
      if(document.querySelector('.shell')?.classList.contains('lfc-inspector-collapsed')) document.querySelector('[data-lfc-toggle-inspector]')?.click();
      return true;
    })()`);
    await wait(150);

    await cdp.evaluate("window.lingframeAppearance.set({theme:'dark',fontSize:'standard'})");
    const layouts = [];
    for (const viewport of truth.viewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: false });
      await wait(120);
      layouts.push(await cdp.evaluate(`(${layoutProbe.toString()})()`));
    }
    const first = layouts[0];
    const last = layouts[layouts.length - 1];
    const viewportGrowth = last.viewport.height - first.viewport.height;
    const stageGrowth = last.stage.height - first.stage.height;
    check("主窗口增高时无限画布同步增高", stageGrowth >= viewportGrowth * truth.minimumStageGrowthRatio, { viewportGrowth, stageGrowth, layouts });
    check("无限画布贴合工作区底部", layouts.every(item => item.bottomGap >= 0 && item.bottomGap <= truth.maximumWorkspaceBottomGapPx), layouts);
    check("无限画布左右栏无横向溢出", layouts.every(item => item.left.scrollWidth <= item.left.clientWidth + truth.maximumHorizontalOverflowPx && item.right.scrollWidth <= item.right.clientWidth + truth.maximumHorizontalOverflowPx), layouts);

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await cdp.evaluate("window.lingframeAppearance.set({theme:'dark',fontSize:'standard'})");
    await wait(100);
    const standard = await cdp.evaluate(`(${fontProbe.toString()})()`);
    await cdp.evaluate("window.lingframeAppearance.set({theme:'dark',fontSize:'xlarge'})");
    await wait(100);
    const xlarge = await cdp.evaluate(`(${fontProbe.toString()})()`);
    const sidebarKeys = ["leftTitle", "leftItem", "leftSubtitle", "rightTitle", "rightSubtitle", "rightTab"];
    const ratios = Object.fromEntries(sidebarKeys.map(key => [key, xlarge[key] / standard[key]]));
    check("无限画布左右侧栏文字跟随系统字号", sidebarKeys.every(key => ratios[key] >= truth.minimumSidebarFontScaleRatio), { standard, xlarge, ratios });
    check("画布节点字号不受系统字号挤压", Math.abs(xlarge.nodeTitle - standard.nodeTitle) <= 0.1, { standard, xlarge });
  } finally {
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    if (savedCanvasPanels) await cdp.evaluate(`(()=>{
      const saved=${JSON.stringify(savedCanvasPanels)};
      const leftCollapsed=document.querySelector('.lfc-stage')?.classList.contains('left-collapsed') === true;
      const inspectorCollapsed=document.querySelector('.shell')?.classList.contains('lfc-inspector-collapsed') === true;
      if(leftCollapsed !== saved.leftCollapsed) document.querySelector('[data-lfc-toggle-left]')?.click();
      if(inspectorCollapsed !== saved.inspectorCollapsed) document.querySelector('[data-lfc-toggle-inspector]')?.click();
      return true;
    })()`).catch(() => {});
    await cdp.evaluate(`(()=>{const saved=${JSON.stringify(savedAppearance)};if(saved===null)localStorage.removeItem('lingframe.appearance.v1');else localStorage.setItem('lingframe.appearance.v1',saved);document.querySelector('[data-page=${JSON.stringify(activePage)}]')?.click();location.reload();return true})()`).catch(() => {});
    cdp.close();
  }

  const failed = checks.filter(item => !item.ok);
  const report = { test: "infinite-canvas-responsive-runtime", timestamp: new Date().toISOString(), port, targetHint, groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, "infinite-canvas-responsive-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
