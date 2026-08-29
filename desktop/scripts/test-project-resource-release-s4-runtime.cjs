"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawn, spawnSync} = require("child_process");
const RuntimeWebSocket = globalThis.WebSocket || require("undici").WebSocket;

const root = path.resolve(__dirname, "..");
const sourceUserData = path.join(root, ".local-user-data-project-resource-s3-20260817-125045");
const userData = path.join(root, ".local-user-data-project-resource-s4-20260817-132817");
const outputRoot = path.join(root, "scripts", "log", "project-resource-s4-runtime");
const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const ports = [9579, 9580];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), detail});
const digest = value => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").toUpperCase();

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks))); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(1200, () => request.destroy(new Error("timeout")));
  });
}

async function waitForTarget(port) {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
      if (target) return target;
    } catch (error) { lastError = error; }
    await wait(250);
  }
  throw lastError || new Error(`端口 ${port} 未发现灵帧AI窗口`);
}

async function connect(target) {
  const socket = new RuntimeWebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  const exceptions = [];
  let nextId = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id) {
      if (message.method === "Runtime.exceptionThrown") exceptions.push(message.params?.exceptionDetails || message.params || {});
      return;
    }
    if (!pending.has(message.id)) return;
    const item = pending.get(message.id);
    pending.delete(message.id);
    clearTimeout(item.timer);
    message.error ? item.reject(new Error(message.error.message)) : item.resolve(message.result || {});
  });
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, {once:true});
    socket.addEventListener("error", reject, {once:true});
  });
  return {
    socket,
    exceptions,
    send(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} 超时`)); }, 20000);
        pending.set(id, {resolve, reject, timer});
        socket.send(JSON.stringify({id, method, params}));
      });
    }
  };
}

function prepareUserData() {
  if (!fs.existsSync(sourceUserData)) throw new Error(`缺少 S3 隔离数据：${sourceUserData}`);
  if (!fs.existsSync(userData)) fs.cpSync(sourceUserData, userData, {recursive:true});
  const activePort = path.join(userData, "DevToolsActivePort");
  if (fs.existsSync(activePort)) fs.rmSync(activePort, {force:true});
  fs.mkdirSync(outputRoot, {recursive:true});
}

function stop(child) {
  if (child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide:true, stdio:"ignore"});
}

function launch(port) {
  const activePort = path.join(userData, "DevToolsActivePort");
  if (fs.existsSync(activePort)) fs.rmSync(activePort, {force:true});
  return spawn(electron, [".", `--remote-debugging-port=${port}`, "--no-sandbox"], {
    cwd:root,
    windowsHide:true,
    stdio:"ignore",
    env:{...process.env, LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1", LINGFRAME_TEST_USER_DATA:userData}
  });
}

async function session(port) {
  const child = launch(port);
  let cdp;
  try {
    cdp = await connect(await waitForTarget(port));
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("HeapProfiler.enable");
    const evaluate = async expression => {
      const response = await cdp.send("Runtime.evaluate", {expression, awaitPromise:true, returnByValue:true});
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "运行时求值失败");
      return response.result?.value;
    };
    const click = async selector => {
      const point = await evaluate(`(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;const r=node.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}})()`);
      if (!point) throw new Error(`找不到点击目标：${selector}`);
      await cdp.send("Input.dispatchMouseEvent", {type:"mousePressed", x:point.x, y:point.y, button:"left", clickCount:1});
      await cdp.send("Input.dispatchMouseEvent", {type:"mouseReleased", x:point.x, y:point.y, button:"left", clickCount:1});
    };
    const key = async (keyValue, code, virtualKeyCode, modifiers = 0) => {
      const text = keyValue === "Enter" ? "\r" : undefined;
      await cdp.send("Input.dispatchKeyEvent", {type:"keyDown", key:keyValue, code, text, unmodifiedText:text, windowsVirtualKeyCode:virtualKeyCode, nativeVirtualKeyCode:virtualKeyCode, modifiers});
      await cdp.send("Input.dispatchKeyEvent", {type:"keyUp", key:keyValue, code, windowsVirtualKeyCode:virtualKeyCode, nativeVirtualKeyCode:virtualKeyCode, modifiers});
    };
    return {child, cdp, evaluate, click, enter:()=>key("Enter", "Enter", 13), escape:()=>key("Escape", "Escape", 27), tab:shift=>key("Tab", "Tab", 9, shift?8:0)};
  } catch (error) {
    try { cdp?.socket.close(); } catch {}
    stop(child);
    throw error;
  }
}

async function closeSession(active) {
  try { active?.cdp?.socket.close(); } catch {}
  stop(active?.child);
  await wait(200);
}

const fingerprintExpression = `(()=>{const stable=(items,fields)=>items.map(item=>Object.fromEntries(fields.map(field=>[field,item?.[field]??null]))).sort((a,b)=>String(a.id).localeCompare(String(b.id)));return window.lingframe.workbench.bootstrap().then(data=>({currentProjectId:data.currentProjectId,projects:stable(data.projects||[],['id','name','archivedAt','deletedAt']),assets:stable(data.assets||[],['id','projectId','name','type','archivedAt','deletedAt']),tasks:stable(data.tasks||[],['id','projectId','state','resultAssetId','resultVid']),textConversations:stable(data.textConversations||[],['id','projectId','title'])}))})()`;
const domExpression = `(()=>({nodes:document.querySelectorAll('*').length,assets:document.querySelectorAll('.resource-asset-grid .asset-card').length,projects:document.querySelectorAll('.resource-project-item').length,doubao:document.querySelectorAll('[data-select-doubao-asset]').length,batch:Boolean(document.querySelector('[data-copy-doubao-links]')),dialogs:document.querySelectorAll('.pm-modal').length,toasts:document.querySelectorAll('.pm-toast').length,legacy:[...document.querySelectorAll('.sidebar .nav')].filter(node=>['素材中心','项目管理'].includes(node.textContent.trim())).length,mode:[...document.querySelectorAll('[data-resource-mode]')].find(node=>node.getAttribute('aria-pressed')==='true')?.dataset.resourceMode||''}))()`;

(async () => {
  prepareUserData();
  let first;
  let second;
  try {
    first = await session(ports[0]);
    await first.cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await first.evaluate("location.reload();true");
    await wait(1500);
    await first.click('[data-page="resources"]');
    await wait(650);
    await first.click('[data-resource-project="all"]');
    await wait(120);
    const dataBefore = await first.evaluate(fingerprintExpression);
    const fingerprintBefore = digest(dataBefore);
    const domBefore = await first.evaluate(domExpression);
    await first.cdp.send("HeapProfiler.collectGarbage");
    const heapBefore = await first.cdp.send("Runtime.getHeapUsage");

    for (let index = 0; index < 20; index += 1) {
      await first.click('[data-resource-mode="projects"]');
      await first.click('[data-resource-mode="assets"]');
      await first.evaluate(`document.querySelector('[data-asset-type="video"]')?.focus();true`);
      await first.enter();
      await first.evaluate(`document.querySelector('[data-asset-type="all"]')?.focus();true`);
      await first.enter();
      await first.click('[data-resource-safety-toggle]');
      await first.click('[data-resource-safety-toggle]');
      await first.click('.resource-head-actions [data-project-create]');
      await first.escape();
      await first.click('[data-asset-action="preview"]');
      await first.escape();
    }

    await first.cdp.send("Emulation.setDeviceMetricsOverride", {width:900, height:720, deviceScaleFactor:1, mobile:false});
    await wait(100);
    for (let index = 0; index < 10; index += 1) {
      await first.evaluate(`document.querySelector('[data-resource-rail-toggle]')?.focus();true`);
      await first.enter();
      await first.enter();
    }
    await first.cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await wait(120);
    const dataAfterSoak = await first.evaluate(fingerprintExpression);
    const fingerprintAfterSoak = digest(dataAfterSoak);
    const domAfter = await first.evaluate(domExpression);
    await first.cdp.send("HeapProfiler.collectGarbage");
    const heapAfter = await first.cdp.send("Runtime.getHeapUsage");
    const heapGrowth = Number(heapAfter.usedSize || 0) - Number(heapBefore.usedSize || 0);

    check("20 轮模式/筛选/弹窗循环后数据指纹不变", fingerprintAfterSoak === fingerprintBefore, {fingerprintBefore, fingerprintAfterSoak});
    check("循环后项目素材和豆包结果数量保持", domAfter.assets === 18 && domAfter.projects === 1 && domAfter.doubao === 7 && domAfter.batch, {domBefore, domAfter});
    check("循环后没有孤立弹窗或 Toast", domAfter.dialogs === 0 && domAfter.toasts <= 1, domAfter);
    check("循环后 DOM 节点没有持续累积", Math.abs(domAfter.nodes - domBefore.nodes) <= 12, {before:domBefore.nodes, after:domAfter.nodes});
    check("垃圾回收后渲染堆增长处于稳定范围", heapGrowth <= 12 * 1024 * 1024, {before:heapBefore.usedSize, after:heapAfter.usedSize, growth:heapGrowth});
    check("循环交互没有运行时未捕获异常", first.cdp.exceptions.length === 0, first.cdp.exceptions.slice(0, 5));
    check("旧素材中心和项目管理导航未恢复", domAfter.legacy === 0, domAfter);
    check("循环结束仍回到素材库模式", domAfter.mode === "assets", domAfter);

    const soakShot = await first.cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    fs.writeFileSync(path.join(outputRoot, "s4-soak-1440x900.png"), Buffer.from(soakShot.data, "base64"));
    await closeSession(first);
    first = null;

    second = await session(ports[1]);
    await second.cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await wait(1100);
    await second.click('[data-page="resources"]');
    await wait(650);
    await second.click('[data-resource-project="all"]');
    await wait(120);
    const dataRestart = await second.evaluate(fingerprintExpression);
    const fingerprintRestart = digest(dataRestart);
    const domRestart = await second.evaluate(domExpression);
    const ariaRestart = await second.evaluate(`(()=>({mode:[...document.querySelectorAll('[data-resource-mode]')].map(n=>[n.dataset.resourceMode,n.getAttribute('aria-pressed')]),preview:document.querySelector('[data-asset-action="preview"]')?.getAttribute('aria-label'),railControls:document.querySelector('[data-resource-rail-toggle]')?.getAttribute('aria-controls'),safetyControls:document.querySelector('[data-resource-safety-toggle]')?.getAttribute('aria-controls')}))()`);
    await second.click('.resource-head-actions [data-project-create]');
    await wait(50);
    await second.escape();
    await wait(80);
    const restored = await second.evaluate(`document.activeElement?.matches('.resource-head-actions [data-project-create]')`);

    check("重启后项目资源数据指纹保持", fingerprintRestart === fingerprintBefore, {fingerprintBefore, fingerprintRestart});
    check("重启后 18 素材、1 项目、7 豆包控件恢复", domRestart.assets === 18 && domRestart.projects === 1 && domRestart.doubao === 7 && domRestart.batch, domRestart);
    check("重启后默认素材模式和 ARIA 状态恢复", domRestart.mode === "assets" && ariaRestart.mode.some(item=>item[0] === "assets" && item[1] === "true"), ariaRestart);
    check("重启后预览及折叠区域辅助语义恢复", /^预览素材：/.test(ariaRestart.preview || "") && ariaRestart.railControls === "resource-project-rail-body" && ariaRestart.safetyControls === "resource-safety-body", ariaRestart);
    check("重启后 Escape 仍恢复原操作焦点", restored, {restored});
    check("重启实例没有运行时未捕获异常", second.cdp.exceptions.length === 0, second.cdp.exceptions.slice(0, 5));

    const restartShot = await second.cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    fs.writeFileSync(path.join(outputRoot, "s4-restart-1440x900.png"), Buffer.from(restartShot.data, "base64"));

    const failed = checks.filter(item => !item.ok);
    const report = {test:"project-resource-release-s4-runtime", timestamp:new Date().toISOString(), ok:failed.length===0, ports, isolatedUserData:path.relative(root,userData).split(path.sep).join("/"), cycles:{desktop:20,narrowRail:10,restarts:1}, total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks, evidence:["s4-soak-1440x900.png","s4-restart-1440x900.png"]};
    fs.writeFileSync(path.join(outputRoot, "s4-release-runtime.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    if (first) await closeSession(first);
    if (second) await closeSession(second);
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
