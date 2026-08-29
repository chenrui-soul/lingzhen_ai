"use strict";

const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawn, spawnSync} = require("child_process");
const RuntimeWebSocket = globalThis.WebSocket || require("undici").WebSocket;

const root = path.resolve(__dirname, "..");
const unpackedRoot = path.join(root, "dist-tenant", "win-unpacked");
const appExe = path.join(unpackedRoot, "灵帧AI.exe");
const sourceSystem = path.join(root, ".local-user-data-project-resource-s4-20260817-132817", "system");
const userData = path.join(root, ".local-user-data-project-resource-s5-packaged-20260817");
const outputRoot = path.join(root, "scripts", "log", "project-resource-s5-runtime");
const ports = [9591, 9592];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const checks = [];
const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), detail});
const sha256 = value => crypto.createHash("sha256").update(value).digest("hex").toUpperCase();

function inside(base, candidate) {
  const resolvedBase = path.resolve(base);
  const resolvedTarget = path.resolve(candidate);
  return resolvedTarget !== resolvedBase && resolvedTarget.startsWith(resolvedBase + path.sep);
}

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
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
      const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
      if (target) return target;
    } catch (error) { lastError = error; }
    await wait(250);
  }
  throw lastError || new Error(`端口 ${port} 未发现打包版灵帧AI窗口`);
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
  if (!fs.existsSync(appExe)) throw new Error(`缺少打包版主程序：${appExe}`);
  if (!fs.existsSync(sourceSystem)) throw new Error(`缺少 S4 隔离系统身份目录：${sourceSystem}`);
  if (!inside(root, userData)) throw new Error(`拒绝清理工作区外路径：${userData}`);
  if (fs.existsSync(userData)) fs.rmSync(userData, {recursive:true, force:true});
  fs.mkdirSync(userData, {recursive:true});
  fs.cpSync(sourceSystem, path.join(userData, "system"), {recursive:true});
  fs.mkdirSync(outputRoot, {recursive:true});
}

function stop(child) {
  if (child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide:true, stdio:"ignore"});
}

function launch(port) {
  const activePort = path.join(userData, "DevToolsActivePort");
  if (fs.existsSync(activePort)) fs.rmSync(activePort, {force:true});
  return spawn(appExe, [`--remote-debugging-port=${port}`, "--no-sandbox"], {
    cwd:unpackedRoot,
    windowsHide:true,
    stdio:"ignore",
    env:{
      ...process.env,
      LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1",
      LINGFRAME_TEST_USER_DATA:userData,
      LINGFRAME_DISABLE_LEGACY_IDENTITY:"1",
      LINGFRAME_AGENT_TEST_MODE:"1"
    }
  });
}

async function session(port) {
  const child = launch(port);
  let cdp;
  try {
    const target = await waitForTarget(port);
    cdp = await connect(target);
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
    const escape = async () => {
      await cdp.send("Input.dispatchKeyEvent", {type:"keyDown", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27});
      await cdp.send("Input.dispatchKeyEvent", {type:"keyUp", key:"Escape", code:"Escape", windowsVirtualKeyCode:27, nativeVirtualKeyCode:27});
    };
    return {child, cdp, target, evaluate, click, escape};
  } catch (error) {
    try { cdp?.socket.close(); } catch {}
    stop(child);
    throw error;
  }
}

async function closeSession(active) {
  try { active?.cdp?.socket.close(); } catch {}
  stop(active?.child);
  await wait(300);
}

function tenantState() {
  const tenantsRoot = path.join(userData, "tenants");
  const tenantIds = fs.existsSync(tenantsRoot) ? fs.readdirSync(tenantsRoot, {withFileTypes:true}).filter(item => item.isDirectory()).map(item => item.name) : [];
  const workbenchFiles = tenantIds.map(tenantId => path.join(tenantsRoot, tenantId, "database", "workbench-data-v1.json")).filter(file => fs.existsSync(file));
  const file = workbenchFiles[0] || null;
  const buffer = file ? fs.readFileSync(file) : null;
  return {tenantIds, workbenchFiles, file, hash:buffer ? sha256(buffer) : null, data:buffer ? JSON.parse(buffer.toString("utf8")) : null};
}

const bootstrapExpression = `Promise.all([window.lingframe.app.diagnostics(),window.lingframe.license.status(),window.lingframe.identity.status(),window.lingframe.workbench.bootstrap()]).then(([diagnostics,license,identity,workbench])=>({diagnostics,license,identity,workbench}))`;
const domExpression = `(()=>({title:document.title,heading:document.querySelector('.workspace h1')?.textContent?.trim()||'',projects:document.querySelectorAll('.resource-project-item').length,assets:document.querySelectorAll('.resource-asset-grid .asset-card').length,empty:document.querySelector('.resource-asset-grid .pm-empty')?.textContent?.trim()||'',legacy:[...document.querySelectorAll('.sidebar .nav')].filter(node=>['素材中心','项目管理'].includes(node.textContent.trim())).length,mode:[...document.querySelectorAll('[data-resource-mode]')].find(node=>node.getAttribute('aria-pressed')==='true')?.dataset.resourceMode||'',create:Boolean(document.querySelector('.resource-head-actions [data-project-create]'))}))()`;

(async () => {
  prepareUserData();
  check("启动前只复制 system 且不存在 tenants", fs.existsSync(path.join(userData, "system")) && !fs.existsSync(path.join(userData, "tenants")), {userData, sourceSystem});
  let first;
  let second;
  let firstDisk;
  try {
    first = await session(ports[0]);
    await first.cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await wait(1700);
    const firstBootstrap = await first.evaluate(bootstrapExpression);
    check("打包版诊断版本与平台正确", firstBootstrap.diagnostics?.version === "0.12.2" && firstBootstrap.diagnostics?.platform === "win32", firstBootstrap.diagnostics);
    check("复制的系统身份可用且冷启动未锁定工作台", Boolean(firstBootstrap.identity?.usable) && !firstBootstrap.workbench?.locked, {identity:firstBootstrap.identity, license:firstBootstrap.license});
    check("全新租户自动创建一个默认项目", firstBootstrap.workbench?.projects?.length === 1 && firstBootstrap.workbench.projects[0]?.name === "默认项目" && firstBootstrap.workbench.currentProjectId === firstBootstrap.workbench.projects[0]?.id, firstBootstrap.workbench);
    check("全新租户没有素材、任务、文本会话和额度锁", firstBootstrap.workbench?.assets?.length === 0 && firstBootstrap.workbench?.tasks?.length === 0 && firstBootstrap.workbench?.textConversations?.length === 0 && firstBootstrap.workbench?.doubaoQuotaBlocks?.length === 0, firstBootstrap.workbench);

    await first.click('[data-page="resources"]');
    await wait(750);
    const firstDom = await first.evaluate(domExpression);
    check("打包版进入唯一项目资源库入口", firstDom.heading === "项目资源库" && firstDom.legacy === 0, firstDom);
    check("空租户项目资源库显示 1 项目、0 素材和素材模式", firstDom.projects === 1 && firstDom.assets === 0 && firstDom.empty.includes("没有找到素材") && firstDom.mode === "assets", firstDom);
    check("空租户仍可打开新建项目并立即 Escape", firstDom.create, firstDom);
    await first.click('.resource-head-actions [data-project-create]');
    await first.escape();
    await wait(100);
    const escapeState = await first.evaluate(`({dialogs:document.querySelectorAll('.pm-modal').length,focus:document.activeElement?.matches('.resource-head-actions [data-project-create]')})`);
    check("打包版即时 Escape 关闭弹窗并恢复焦点", escapeState.dialogs === 0 && escapeState.focus, escapeState);
    check("首次打包实例没有运行时未捕获异常", first.cdp.exceptions.length === 0, first.cdp.exceptions.slice(0, 5));
    const firstShot = await first.cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    fs.writeFileSync(path.join(outputRoot, "s5-packaged-cold-start-1440x900.png"), Buffer.from(firstShot.data, "base64"));
    await closeSession(first);
    first = null;

    firstDisk = tenantState();
    check("冷启动仅生成一个隔离租户数据库", firstDisk.tenantIds.length === 1 && firstDisk.workbenchFiles.length === 1, {tenantIds:firstDisk.tenantIds, workbenchFiles:firstDisk.workbenchFiles.map(file => path.relative(root, file))});
    check("磁盘默认项目数据与界面冷启动一致", firstDisk.data?.projects?.length === 1 && firstDisk.data.projects[0]?.name === "默认项目" && firstDisk.data?.assets?.length === 0 && firstDisk.data?.tasks?.length === 0 && firstDisk.data?.textConversations?.length === 0, firstDisk.data);

    second = await session(ports[1]);
    await second.cdp.send("Emulation.setDeviceMetricsOverride", {width:1440, height:900, deviceScaleFactor:1, mobile:false});
    await wait(1500);
    const secondBootstrap = await second.evaluate(bootstrapExpression);
    await second.click('[data-page="resources"]');
    await wait(700);
    const secondDom = await second.evaluate(domExpression);
    check("重启后默认项目 ID 和空数据保持", secondBootstrap.workbench?.currentProjectId === firstBootstrap.workbench?.currentProjectId && secondBootstrap.workbench?.projects?.length === 1 && secondBootstrap.workbench?.assets?.length === 0 && secondBootstrap.workbench?.tasks?.length === 0 && secondBootstrap.workbench?.textConversations?.length === 0, {first:firstBootstrap.workbench, second:secondBootstrap.workbench});
    check("重启后项目资源库唯一入口和空态恢复", secondDom.heading === "项目资源库" && secondDom.legacy === 0 && secondDom.projects === 1 && secondDom.assets === 0 && secondDom.empty.includes("没有找到素材") && secondDom.mode === "assets", secondDom);
    check("重启实例没有运行时未捕获异常", second.cdp.exceptions.length === 0, second.cdp.exceptions.slice(0, 5));
    const secondShot = await second.cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    fs.writeFileSync(path.join(outputRoot, "s5-packaged-restart-1440x900.png"), Buffer.from(secondShot.data, "base64"));
    await closeSession(second);
    second = null;

    const secondDisk = tenantState();
    check("重启前后工作台数据库哈希不变", Boolean(firstDisk.hash) && secondDisk.hash === firstDisk.hash, {before:firstDisk.hash, after:secondDisk.hash});

    const failed = checks.filter(item => !item.ok);
    const report = {
      test:"project-resource-release-s5-runtime",
      timestamp:new Date().toISOString(),
      ok:failed.length === 0,
      executable:path.relative(root, appExe).split(path.sep).join("/"),
      ports,
      isolatedUserData:path.relative(root, userData).split(path.sep).join("/"),
      copiedSystemOnly:true,
      installed:false,
      total:checks.length,
      passed:checks.length - failed.length,
      failed:failed.length,
      checks,
      evidence:["s5-packaged-cold-start-1440x900.png", "s5-packaged-restart-1440x900.png"]
    };
    fs.writeFileSync(path.join(outputRoot, "s5-release-runtime.json"), JSON.stringify(report, null, 2));
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
