"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawn, spawnSync} = require("child_process");
const RuntimeWebSocket = globalThis.WebSocket || require("undici").WebSocket;

const root = path.resolve(__dirname, "..");
const sourceUserData = path.join(root, ".local-user-data-project-resource-s2-20260817-120027");
const userData = path.join(root, ".local-user-data-project-resource-s3-20260817-125045");
const outputRoot = path.join(root, "scripts", "log", "project-resource-s3-runtime");
const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const port = 9576;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), detail});

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

async function waitForTarget() {
  let lastError;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
      if (target) return target;
    } catch (error) { lastError = error; }
    await wait(250);
  }
  throw lastError || new Error("未发现 S3 隔离预览窗口");
}

async function connect(target) {
  const socket = new RuntimeWebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let nextId = 0;
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
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
  if (!fs.existsSync(sourceUserData)) throw new Error(`缺少 S2 隔离数据：${sourceUserData}`);
  if (!fs.existsSync(userData)) fs.cpSync(sourceUserData, userData, {recursive:true});
  const activePort = path.join(userData, "DevToolsActivePort");
  if (fs.existsSync(activePort)) fs.rmSync(activePort, {force:true});
  fs.mkdirSync(outputRoot, {recursive:true});
}

function stop(child) {
  if (child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide:true, stdio:"ignore"});
}

async function main() {
  prepareUserData();
  const child = spawn(electron, [".", `--remote-debugging-port=${port}`, "--no-sandbox"], {
    cwd:root,
    windowsHide:true,
    stdio:["ignore", "pipe", "pipe"],
    env:{...process.env, LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1", LINGFRAME_TEST_USER_DATA:userData}
  });
  const stderr = [];
  child.stderr.on("data", chunk => stderr.push(String(chunk)));
  let cdp;
  try {
    cdp = await connect(await waitForTarget());
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
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
    const enter = () => key("Enter", "Enter", 13);
    const escape = () => key("Escape", "Escape", 27);
    const tab = shift => key("Tab", "Tab", 9, shift ? 8 : 0);

    await cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await evaluate("location.reload();true");
    await wait(1600);
    await click('[data-page="resources"]');
    await wait(750);
    await click('[data-resource-project="all"]');
    await wait(180);

    const baseline = await evaluate(`(()=>({title:document.querySelector('.page-head h1')?.textContent.trim(),assets:document.querySelectorAll('.resource-asset-grid .asset-card').length,projects:document.querySelectorAll('.resource-project-item').length,doubao:document.querySelectorAll('[data-select-doubao-asset]').length,batch:Boolean(document.querySelector('[data-copy-doubao-links]')),dialogs:document.querySelectorAll('[role="dialog"]').length,pressed:[...document.querySelectorAll('[data-resource-mode]')].map(n=>[n.dataset.resourceMode,n.getAttribute('aria-pressed')])}))()`);
    check("S3 隔离实例进入项目资源库", baseline.title === "项目资源库" && baseline.assets === 18 && baseline.projects === 1, baseline);
    check("豆包 7 个选择控件和批量复制保持", baseline.doubao === 7 && baseline.batch, baseline);
    check("资源模式暴露 aria-pressed", baseline.pressed.some(item => item[0] === "assets" && item[1] === "true"), baseline.pressed);

    await click('[data-resource-mode="projects"]');
    await wait(160);
    let focus = await evaluate(`(()=>({mode:document.querySelector('[data-resource-mode="projects"]')?.getAttribute('aria-pressed'),active:document.activeElement?.dataset?.resourceMode||'',cards:document.querySelectorAll('.resource-project-grid .project-manage-card').length}))()`);
    check("真实点击切换模式后焦点留在原控件", focus.mode === "true" && focus.active === "projects" && focus.cards === 1, focus);
    await evaluate(`document.querySelector('.resource-projects-panel [data-project-status="active"]')?.focus();true`);
    await enter();
    await wait(140);
    focus = await evaluate(`(()=>({status:document.activeElement?.dataset?.projectStatus||'',panel:Boolean(document.activeElement?.closest('.resource-projects-panel')),pressed:document.activeElement?.getAttribute('aria-pressed')}))()`);
    check("重复项目状态组重绘后焦点留在原分组", focus.status === "active" && focus.panel && focus.pressed === "true", focus);
    await click('[data-resource-mode="assets"]');
    await wait(160);

    await evaluate(`document.querySelector('[data-asset-type="video"]')?.focus();true`);
    await enter();
    await wait(160);
    focus = await evaluate(`(()=>({active:document.activeElement?.dataset?.assetType||'',pressed:document.querySelector('[data-asset-type="video"]')?.getAttribute('aria-pressed'),cards:document.querySelectorAll('.resource-asset-grid .asset-card').length,types:[...document.querySelectorAll('.asset-type')].map(n=>n.textContent.trim())}))()`);
    check("Enter 激活类型筛选且重绘后焦点保持", focus.active === "video" && focus.pressed === "true" && focus.cards === 7 && focus.types.every(value => value === "视频"), focus);
    await evaluate(`document.querySelector('[data-asset-type="all"]')?.focus();true`);
    await enter();
    await wait(150);

    await click('[data-asset-search]');
    await tab(false);
    await wait(80);
    focus = await evaluate(`(()=>({tag:document.activeElement?.tagName,project:Boolean(document.activeElement?.matches('[data-asset-project]')),label:document.activeElement?.getAttribute('aria-label')}))()`);
    check("Tab 从搜索进入项目筛选", focus.tag === "SELECT" && focus.project && focus.label === "按项目筛选", focus);

    await evaluate(`document.querySelector('[data-resource-project="all"]')?.focus();true`);
    await enter();
    await wait(150);
    focus = await evaluate(`(()=>({active:document.activeElement?.dataset?.resourceProject||'',pressed:document.querySelector('[data-resource-project="all"]')?.getAttribute('aria-pressed'),current:document.querySelector('[data-resource-project="all"]')?.getAttribute('aria-current')}))()`);
    check("项目筛选重绘后焦点和当前状态保持", focus.active === "all" && focus.pressed === "true" && focus.current === "true", focus);

    const opener = '.resource-head-actions [data-project-create]';
    await click(opener);
    await wait(120);
    let dialog = await evaluate(`(()=>{const d=document.querySelector('[role="dialog"]');return{exists:Boolean(d),modal:d?.getAttribute('aria-modal'),labelled:d?.getAttribute('aria-labelledby'),described:d?.getAttribute('aria-describedby'),focus:document.activeElement?.dataset?.projectName!==undefined,closeLabel:d?.querySelector('button[data-modal-close]')?.getAttribute('aria-label')}})()`);
    check("新建项目弹窗具备标准语义和初始焦点", dialog.exists && dialog.modal === "true" && dialog.labelled && dialog.described && dialog.focus && dialog.closeLabel === "关闭对话框", dialog);
    await escape();
    await wait(120);
    focus = await evaluate(`(()=>({closed:!document.querySelector('[role="dialog"]'),restored:document.activeElement?.matches('.resource-head-actions [data-project-create]')}))()`);
    check("Escape 关闭弹窗并恢复原按钮焦点", focus.closed && focus.restored, focus);

    await click(opener);
    await wait(100);
    await evaluate(`document.querySelector('[data-project-save]')?.focus();true`);
    await tab(false);
    await wait(60);
    const wrappedForward = await evaluate(`document.activeElement?.getAttribute('aria-label')==='关闭对话框'`);
    await tab(true);
    await wait(60);
    const wrappedBackward = await evaluate(`document.activeElement?.matches('[data-project-save]')`);
    check("Tab 与 Shift+Tab 被限制在弹窗内", wrappedForward && wrappedBackward, {wrappedForward, wrappedBackward});
    await escape();
    await wait(100);

    await click('[data-asset-action="preview"]');
    await wait(120);
    dialog = await evaluate(`(()=>({dialog:Boolean(document.querySelector('.preview-modal [role="dialog"]')),name:document.querySelector('[data-asset-action="preview"]')?.getAttribute('aria-label'),modal:document.querySelector('.preview-modal [role="dialog"]')?.getAttribute('aria-modal')}))()`);
    check("素材预览拥有明确名称和模态语义", dialog.dialog && /^预览素材：/.test(dialog.name || "") && dialog.modal === "true", dialog);
    await escape();
    await wait(100);

    await click('[data-resource-mode="projects"]');
    await wait(140);
    await click('[data-project-action="delete"]');
    await wait(100);
    dialog = await evaluate(`(()=>({open:Boolean(document.querySelector('[role="dialog"]')),title:document.querySelector('[role="dialog"] .pm-dialog-head b')?.textContent.trim()}))()`);
    await escape();
    await wait(160);
    focus = await evaluate(`(()=>({closed:!document.querySelector('[role="dialog"]'),restored:document.activeElement?.dataset?.projectAction==='delete',mode:document.querySelector('[data-resource-mode="projects"]')?.getAttribute('aria-pressed')}))()`);
    check("确认框 Escape 解析为取消且不刷新丢焦点", dialog.open && dialog.title === "删除项目" && focus.closed && focus.restored && focus.mode === "true", {dialog, focus});

    await click('[data-resource-mode="assets"]');
    await wait(140);
    await cdp.send("Emulation.setDeviceMetricsOverride", {width:900, height:720, deviceScaleFactor:1, mobile:false});
    await wait(180);
    await evaluate(`document.querySelector('[data-resource-rail-toggle]')?.focus();true`);
    await enter();
    await wait(140);
    const rail = await evaluate(`(()=>({expanded:document.querySelector('[data-resource-rail-toggle]')?.getAttribute('aria-expanded'),controls:document.querySelector('[data-resource-rail-toggle]')?.getAttribute('aria-controls'),visible:getComputedStyle(document.querySelector('.resource-project-rail-body')).display!=='none',focused:document.activeElement?.matches('[data-resource-rail-toggle]')}))()`);
    check("900px 项目栏可用键盘展开且焦点保持", rail.expanded === "true" && rail.controls === "resource-project-rail-body" && rail.visible && rail.focused, rail);
    await enter();
    await wait(100);

    await cdp.send("Emulation.setEmulatedMedia", {features:[{name:"prefers-reduced-motion", value:"reduce"}]});
    const motion = await evaluate(`(()=>{const node=document.querySelector('[data-resource-mode]'),duration=getComputedStyle(node).transitionDuration;return{matches:matchMedia('(prefers-reduced-motion: reduce)').matches,duration,numeric:Number.parseFloat(duration)}})()`);
    check("减少动画偏好在运行时生效", motion.matches && Number.isFinite(motion.numeric) && motion.numeric < 0.001, motion);
    await cdp.send("Emulation.setEmulatedMedia", {features:[]});

    await cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await wait(120);
    const screenshot = await cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    fs.writeFileSync(path.join(outputRoot, "s3-accessibility-1440x900.png"), Buffer.from(screenshot.data, "base64"));

    const failed = checks.filter(item => !item.ok);
    const report = {
      test:"project-resource-accessibility-s3-runtime",
      ok:failed.length === 0,
      port,
      isolatedUserData:path.relative(root, userData).split(path.sep).join("/"),
      total:checks.length,
      passed:checks.length - failed.length,
      failed:failed.length,
      checks,
      screenshot:"s3-accessibility-1440x900.png",
      completedAt:new Date().toISOString()
    };
    fs.writeFileSync(path.join(outputRoot, "s3-accessibility-runtime.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    try { cdp?.socket.close(); } catch {}
    stop(child);
    if (stderr.length) fs.writeFileSync(path.join(outputRoot, "electron.stderr.log"), stderr.join(""), "utf8");
  }
}

main().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
