const fs = require("fs");
const path = require("path");
const { WebSocket } = require("undici");

const root = path.join(__dirname, "..");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const checks = [];

function check(name, ok, detail = null) {
  checks.push({ name, ok: Boolean(ok), detail });
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
  if (!target) throw new Error(`端口 ${port} 未找到灵帧AI客户端页面`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 12000);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "evaluate failed");
    return result.result?.value;
  };
  return { evaluate, close: () => socket.close() };
}

async function waitFor(evaluate, expression, timeout = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return true;
    await wait(80);
  }
  return false;
}

async function inspectPage(cdp, route, selector, label) {
  const clicked = await cdp.evaluate(`(()=>{const target=document.querySelector('[data-page=${JSON.stringify(route)}]');if(!target)return false;target.click();return true})()`);
  const ready = clicked && await waitFor(cdp.evaluate, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  const detail = await cdp.evaluate(`(()=>({active:document.querySelector('.nav.active[data-page]')?.dataset.page||'',title:document.querySelector('.page-head h1')?.textContent?.trim()||'',workspaceChildren:document.querySelector('.workspace')?.childElementCount||0,selectorFound:Boolean(document.querySelector(${JSON.stringify(selector)}))}))()`);
  check(`${label}可独立加载`, ready && detail.active === route && detail.workspaceChildren > 0, detail);
}

(async () => {
  const cdp = await connect();
  const originalPage = await cdp.evaluate("document.querySelector('.nav.active[data-page]')?.dataset.page||'home'");
  await cdp.evaluate(`(()=>{window.__lingframeG4RuntimeErrors=[];if(!window.__lingframeG4ErrorCapture){window.__lingframeG4ErrorCapture=true;window.addEventListener('error',event=>window.__lingframeG4RuntimeErrors.push(String(event.error?.stack||event.message||event.error||'error')));window.addEventListener('unhandledrejection',event=>window.__lingframeG4RuntimeErrors.push(String(event.reason?.stack||event.reason||'unhandledrejection')))}return true})()`);

  await inspectPage(cdp, "home", "[data-home-prompt]", "创作首页");

  const assetRoute = await cdp.evaluate("document.querySelector('[data-page=resources]')?'resources':(document.querySelector('[data-page=materials]')?'materials':'')");
  if (assetRoute) {
    await inspectPage(cdp, assetRoute, assetRoute === "resources" ? ".resource-library" : ".material-drop", "项目资源库/素材");
  } else {
    check("项目资源库/素材可独立加载", false, "未找到资源导航入口");
  }

  await inspectPage(cdp, "text", ".text-workspace", "文本创作");
  await inspectPage(cdp, "tasks", "[data-task-new]", "任务中心");
  await inspectPage(cdp, "doubao", ".doubao-manager-layout", "豆包管理");
  await inspectPage(cdp, "settings", ".settings-grid", "系统设置");

  const gatewayReady = await waitFor(cdp.evaluate, "Boolean(document.querySelector('#model-gateway-card'))", 10000);
  const gateway = await cdp.evaluate(`(()=>({active:document.querySelector('.nav.active[data-page]')?.dataset.page||'',card:Boolean(document.querySelector('#model-gateway-card')),layout:Boolean(document.querySelector('.model-gateway-layout')),heading:document.querySelector('#model-gateway-card h3')?.textContent?.trim()||''}))()`);
  check("模型网关可独立加载", gatewayReady && gateway.active === "settings" && gateway.card, gateway);

  await inspectPage(cdp, "canvas", "[data-lfc-mounted='1']", "无限画布");

  const runtimeErrors = await cdp.evaluate("window.__lingframeG4RuntimeErrors||[]");
  check("跨模块切换无未处理运行时异常", runtimeErrors.length === 0, runtimeErrors);

  await cdp.evaluate(`document.querySelector('[data-page=${JSON.stringify(originalPage)}]')?.click();true`).catch(() => {});
  const failed = checks.filter(item => !item.ok);
  const report = {
    test: "infinite-canvas-cross-module-loading-cdp",
    timestamp: new Date().toISOString(),
    port,
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks
  };
  fs.mkdirSync(path.join(root, "scripts/log"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts/log/infinite-canvas-cross-module-loading-cdp.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  cdp.close();
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
