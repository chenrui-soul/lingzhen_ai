"use strict";
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {WebSocket} = require("undici");
const root = path.resolve(__dirname, "..");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop_v1");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  throw new Error("隔离 Electron 测试实例未启动");
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
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
    };
    socket.addEventListener("message", handler); socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {expression, awaitPromise:true, returnByValue:true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  return {send, evaluate, close:() => socket.close()};
}

(async () => {
  const cdp = await connect();
  const checks = [];
  const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), detail});
  let createdConversationId = ""; let createdAssetId = "";
  try {
    await cdp.send("Page.reload", {ignoreCache:true}); await wait(500);
    await cdp.evaluate("document.querySelector('[data-page=\"text\"]')?.click(); true"); await wait(300);
    const title = `新建功能验收 ${Date.now()}`;
    await cdp.evaluate("document.querySelector('[data-text-new]')?.click(); true"); await wait(80);
    check("新建按钮打开桌面弹窗", await cdp.evaluate("Boolean(document.querySelector('.text-create-modal [data-text-create-title]'))"));
    await cdp.evaluate(`(()=>{const input=document.querySelector('[data-text-create-title]');input.value=${JSON.stringify(title)};document.querySelector('[data-text-create-type]').value='故事';document.querySelector('[data-text-create-confirm]').click();return true})()`);
    for (let i=0;i<60;i++){if(await cdp.evaluate(`document.querySelector('[data-text-title]')?.value===${JSON.stringify(title)}`))break;await wait(50);}
    createdConversationId = await cdp.evaluate("document.querySelector('[data-text-conversation-id]')?.dataset.textConversationId || ''");
    check("新建创作成功并打开", Boolean(createdConversationId), {createdConversationId, title});

    await cdp.evaluate("(()=>{const area=document.querySelector('[data-text-content]');area.value='预览缩放验收正文';area.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-text-preview]').click();return true})()"); await wait(80);
    const previewBefore = await cdp.evaluate("(()=>{const dialog=document.querySelector('.text-preview-resizable .pm-dialog');if(!dialog)return null;const rect=dialog.getBoundingClientRect();return{resize:getComputedStyle(dialog).resize,width:rect.width,height:rect.height}})()");
    await cdp.evaluate("(()=>{const dialog=document.querySelector('.text-preview-resizable .pm-dialog');if(!dialog)return false;dialog.style.width='640px';dialog.style.height='480px';return true})()"); await wait(50);
    const previewAfter = await cdp.evaluate("(()=>{const dialog=document.querySelector('.text-preview-resizable .pm-dialog');if(!dialog)return null;const rect=dialog.getBoundingClientRect();return{width:rect.width,height:rect.height}})()");
    check("预览窗口允许双向调整大小", previewBefore?.resize === "both", {previewBefore, previewAfter});
    check("预览窗口尺寸可以改变", Boolean(previewBefore && previewAfter && (Math.abs(previewBefore.width-previewAfter.width)>1 || Math.abs(previewBefore.height-previewAfter.height)>1)), {previewBefore, previewAfter});
    await cdp.evaluate("document.querySelector('.text-preview-resizable [data-modal-close]')?.click(); true");

    const rails = await cdp.evaluate("(()=>{const workspace=document.querySelector('.text-workspace');workspace.querySelector('[data-text-layout-toggle=\"left\"]').click();workspace.querySelector('[data-text-layout-toggle=\"right\"]').click();const history=workspace.querySelector('.text-history');const assist=workspace.querySelector('.text-assist');const left=getComputedStyle(history,'::after').content;const right=getComputedStyle(assist,'::after').content;const result={leftCollapsed:workspace.classList.contains('is-left-collapsed'),rightCollapsed:workspace.classList.contains('is-right-collapsed'),left,right,leftWidth:history.getBoundingClientRect().width,rightWidth:assist.getBoundingClientRect().width};workspace.querySelector('[data-text-layout-toggle=\"left\"]').click();workspace.querySelector('[data-text-layout-toggle=\"right\"]').click();return result})()");
    check("收起侧栏保留目录与协作提示", rails?.leftCollapsed && rails?.rightCollapsed && String(rails.left).includes("目录") && String(rails.right).includes("协作"), rails);
    check("收起侧栏实际缩窄到轨道宽度", rails?.leftWidth <= 47 && rails?.rightWidth <= 47, rails);

    const contract = await cdp.evaluate(`(async()=>{const data=await window.lingframe.workbench.bootstrap();const asset=await window.lingframe.assets.createText({projectId:data.currentProjectId,name:'共享契约验收摘录',content:'共享素材契约正文',source:'text-excerpt',sourceLocation:'conversation:${createdConversationId}'});const read=await window.lingframe.assets.readText(asset.id);const exists=(await window.lingframe.workbench.bootstrap()).assets.some(item=>item.id===asset.id);return{assetId:asset.id,type:asset.type,source:asset.source,content:read.content,exists}})()`);
    createdAssetId = contract?.assetId || "";
    check("共享契约创建正式文本素材", contract?.type === "text" && contract?.source === "text-excerpt" && contract?.content === "共享素材契约正文" && contract?.exists, contract);

    await cdp.evaluate("document.querySelector('[data-text-assist-tab=\"assets\"]')?.click(); window.dispatchEvent(new Event('focus')); true"); await wait(350);
    const actions = await cdp.evaluate(`(async()=>{const selector='[data-text-asset-id="${createdAssetId}"]';const card=()=>document.querySelector(selector);const click=action=>card()?.querySelector('[data-text-asset-action="'+action+'"]')?.click();const result={card:Boolean(card())};click('preview');await new Promise(r=>setTimeout(r,80));result.preview=Boolean(document.querySelector('.text-asset-preview-modal'));document.querySelector('.text-asset-preview-modal [data-text-asset-modal-close]')?.click();click('extract');await new Promise(r=>setTimeout(r,80));result.extract=Boolean(document.querySelector('.text-asset-extract-modal'));document.querySelector('.text-asset-extract-modal [data-text-asset-modal-close]')?.click();click('insert');await new Promise(r=>setTimeout(r,80));result.insert=Boolean(document.querySelector('.text-asset-insert-modal'));document.querySelector('.text-asset-insert-modal [data-text-asset-modal-close]')?.click();click('copy');await new Promise(r=>setTimeout(r,120));result.copy=Boolean(document.querySelector('.pm-toast'));return result})()`);
    check("素材库四个操作按钮真实可点击", actions?.card && actions?.preview && actions?.extract && actions?.insert && actions?.copy, actions);

    const screenshot = await cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-ui-fixes-runtime.png"), Buffer.from(screenshot.data, "base64"));
  } finally {
    if (createdAssetId) await cdp.evaluate(`window.lingframe.assets.delete(${JSON.stringify(createdAssetId)}).then(()=>true).catch(()=>false)`).catch(()=>{});
    if (createdConversationId) await cdp.evaluate(`window.lingframe.text.delete(${JSON.stringify(createdConversationId)}).then(()=>true).catch(()=>false)`).catch(()=>{});
    cdp.close();
    if (spawnedElectron) { try { spawnedElectron.kill(); } catch {} }
  }
  const failed = checks.filter(item => !item.ok);
  const report = {test:"text-ui-fixes-runtime", timestamp:new Date().toISOString(), port, targetHint, total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks};
  const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-ui-fixes-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2)); if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
