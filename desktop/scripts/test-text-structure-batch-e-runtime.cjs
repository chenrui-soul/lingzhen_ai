"use strict";
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {WebSocket} = require("undici");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const userData = path.join(root, ".runtime-text-contract-user-data");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9561);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let child = null, cdp = null, originalWorkbench = null, workbenchFile = "", originalStructure = null, structureKey = "";

async function target() {
  for (let index = 0; index < 100; index += 1) {
    await wait(200);
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = list.find(item => String(item.url || "").includes("lingzhen_ai_desktop_v1") && String(item.url || "").includes("src/renderer"));
      if (page) return page;
    } catch {}
  }
  throw new Error("批次 E 隔离 Electron 页面未启动");
}

async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 12000);
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer); socket.removeEventListener("message", handler);
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

function prepare() {
  const tenantsRoot = path.join(userData, "tenants");
  const tenantId = fs.readdirSync(tenantsRoot, {withFileTypes:true}).find(item => item.isDirectory())?.name;
  if (!tenantId) throw new Error("隔离测试目录没有租户");
  const tenant = path.join(tenantsRoot, tenantId);
  workbenchFile = path.join(tenant, "database", "workbench-data-v1.json");
  originalWorkbench = fs.existsSync(workbenchFile) ? fs.readFileSync(workbenchFile) : null;
  const bridge = new WorkbenchDataBridge({tenantRootProvider:() => tenant});
  const data = bridge.bootstrap();
  const projectId = data.currentProjectId || data.projects.find(item => !item.deletedAt && !item.archivedAt)?.id;
  const novel = bridge.createConversation({projectId, title:"批次 E 结构创作验收", type:"小说", content:"# 第一章 云城\n## 场景 1：城门\n正文保持不变"});
  const prompt = bridge.createConversation({projectId, title:"批次 E 旧提示词会话", type:"提示词", content:"旧提示词正文"});
  return {tenantId, projectId, novelId:novel.id, promptId:prompt.id, initialTasks:(data.tasks || []).length};
}

function restore() {
  try { if (originalWorkbench) fs.writeFileSync(workbenchFile, originalWorkbench); else if (fs.existsSync(workbenchFile)) fs.rmSync(workbenchFile); } catch {}
}

(async () => {
  const fixture = prepare();
  try { fs.rmSync(path.join(userData, "DevToolsActivePort"), {force:true}); } catch {}
  child = spawn(path.join(root, "node_modules/electron/dist/electron.exe"), [".", `--remote-debugging-port=${port}`, "--no-sandbox"], {
    cwd:root, windowsHide:true, stdio:"ignore", env:{...process.env, LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1", LINGFRAME_TEST_USER_DATA:userData}
  });
  const checks = [];
  const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), detail});
  try {
    cdp = await connect(await target());
    let moduleReady = false;
    for (let index = 0; index < 60; index += 1) {
      moduleReady = await cdp.evaluate("Boolean(window.lingframeTextStructureCore&&window.lingframeTextStructureBatchE)");
      if (moduleReady) break;
      await wait(100);
    }
    if (!moduleReady) throw new Error("批次 E 结构化模块未完成加载");
    const errors = [];
    await cdp.evaluate("(()=>{window.__batchEErrors=[];window.addEventListener('error',event=>window.__batchEErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener('unhandledrejection',event=>window.__batchEErrors.push(String(event.reason?.stack||event.reason)));return true})()");
    const scope = await cdp.evaluate("(async()=>{const identity=await window.lingframe.identity.status();const tenantId=String(identity?.tenantId||'local');return{tenantId,key:`${window.lingframeTextStructureCore.STORAGE_PREFIX}.${encodeURIComponent(tenantId)}`}})()");
    structureKey = scope.key;
    originalStructure = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(structureKey)})`);
    await cdp.evaluate(`localStorage.removeItem(${JSON.stringify(structureKey)});location.reload();true`);
    await wait(900);
    await cdp.evaluate("document.querySelector('[data-page=text]')?.click();true"); await wait(450);
    await cdp.evaluate(`document.querySelector('[data-text-select=${JSON.stringify(fixture.novelId)}]')?.click();true`); await wait(500);
    const loaded = await cdp.evaluate("(()=>({owner:window.lingframeTextStructureBatchE?.ownsStructure===true,core:Boolean(window.lingframeTextStructureCore),templates:window.lingframeTextStructureBatchE?.templates?.length||0,tab:Boolean(document.querySelector('[data-text-assist-tab=structure]')),left:Boolean(document.querySelector('.text-structure-left')),open:Boolean(document.querySelector('[data-text-structure-open]')),stored:window.lingframeTextStructureBatchE?.getDocument(document.querySelector('[data-text-conversation-id]')?.dataset.textConversationId),body:document.querySelector('[data-text-content]')?.value||''}))()");
    check("批次 E 模块、模板和入口真实加载", loaded.owner && loaded.core && loaded.templates >= 7 && loaded.tab && loaded.left && loaded.open, loaded);
    check("旧小说会话兼容打开且不强制迁移", loaded.stored === null && loaded.body.includes("正文保持不变"), loaded);

    await cdp.evaluate("document.querySelector('[data-text-assist-tab=structure]')?.click();true"); await wait(150);
    const templateUi = await cdp.evaluate("(()=>({active:document.querySelector('[data-text-assist-tab=structure]')?.classList.contains('on'),template:document.querySelector('[data-text-structure-template]')?.value||'',modes:document.querySelectorAll('[data-text-structure-mode]').length,legacy:document.querySelector('[data-text-assist-body=structure]')?.innerText.includes('未强制迁移'),body:document.querySelector('[data-text-content]')?.value||''}))()");
    check("小说会话自动选中小说模板和五种结构模式", templateUi.active && templateUi.template === "novel" && templateUi.modes === 5 && templateUi.legacy, templateUi);

    await cdp.evaluate("document.querySelector('[data-text-structure-add-root]')?.click();true"); await wait(160);
    let documentState = await cdp.evaluate(`window.lingframeTextStructureBatchE.getDocument(${JSON.stringify(fixture.novelId)})`);
    check("第一次结构编辑才创建租户项目会话绑定", documentState?.tenantId === fixture.tenantId && documentState?.projectId === fixture.projectId && documentState?.conversationId === fixture.novelId && documentState?.outline?.length === 1, documentState);
    const rootId = documentState.outline[0].id;
    await cdp.evaluate("(()=>{const input=document.querySelector('[data-text-structure-node-title]');if(!input)return false;input.value='第一章 浮城';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"); await wait(150);
    await cdp.evaluate("(()=>{const input=document.querySelector('[data-text-structure-node-field=\"summary\"]');if(!input)return false;input.value='主角进入浮城';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"); await wait(150);
    await cdp.evaluate("document.querySelector('.text-structure-left [data-text-structure-add-child]')?.click();true"); await wait(180);
    documentState = await cdp.evaluate(`window.lingframeTextStructureBatchE.getDocument(${JSON.stringify(fixture.novelId)})`);
    check("章节树、场景树和结构字段可编辑保存", documentState.outline.length === 2 && documentState.outline[0].title === "第一章 浮城" && documentState.outline[0].fields.summary === "主角进入浮城" && documentState.outline[1].parentId === rootId, documentState.outline);

    await cdp.evaluate("document.querySelector('[data-text-structure-mode=entities]')?.click();true"); await wait(100);
    await cdp.evaluate("document.querySelector('[data-text-structure-entity-add]')?.click();true"); await wait(120);
    await cdp.evaluate("(()=>{const input=document.querySelector('[data-text-structure-entity-field=\"name\"]');if(!input)return false;input.value='云汐';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"); await wait(130);
    await cdp.evaluate("document.querySelector('[data-text-structure-entity-tab=world]')?.click();true"); await wait(100);
    await cdp.evaluate("document.querySelector('[data-text-structure-entity-add]')?.click();true"); await wait(120);
    await cdp.evaluate("(()=>{const input=document.querySelector('[data-text-structure-entity-field=\"name\"]');if(!input)return false;input.value='浮城时间法则';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"); await wait(130);
    await cdp.evaluate("document.querySelector('[data-text-structure-mode=timeline]')?.click();true"); await wait(100);
    await cdp.evaluate("document.querySelector('[data-text-structure-timeline-add]')?.click();true"); await wait(120);
    await cdp.evaluate("(()=>{const input=document.querySelector('[data-text-structure-timeline-field=\"label\"]');if(!input)return false;input.value='进入浮城';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()"); await wait(130);
    documentState = await cdp.evaluate(`window.lingframeTextStructureBatchE.getDocument(${JSON.stringify(fixture.novelId)})`);
    check("人物卡、世界观和时间线分别保存", documentState.characters[0]?.name === "云汐" && documentState.world[0]?.name === "浮城时间法则" && documentState.timeline[0]?.label === "进入浮城", {characters:documentState.characters, world:documentState.world, timeline:documentState.timeline});

    await cdp.evaluate("document.querySelector('[data-text-structure-mode=versions]')?.click();true"); await wait(100);
    await cdp.evaluate("document.querySelector('[data-text-structure-version-create]')?.click();true"); await wait(80);
    await cdp.evaluate("(()=>{const input=document.querySelector('[data-text-structure-version-name]');input.value='批次 E 结构快照';document.querySelector('[data-text-structure-version-confirm]').click();return true})()"); await wait(150);
    documentState = await cdp.evaluate(`window.lingframeTextStructureBatchE.getDocument(${JSON.stringify(fixture.novelId)})`);
    check("结构快照可单独创建和恢复", documentState.versions.length === 1 && documentState.versions[0].label === "批次 E 结构快照", documentState.versions);

    const beforePreview = await cdp.evaluate("document.querySelector('[data-text-content]')?.value||''");
    await cdp.evaluate("document.querySelector('[data-text-structure-preview]')?.click();true"); await wait(100);
    const previewState = await cdp.evaluate("(()=>({open:Boolean(document.querySelector('.text-structure-preview-modal')),markdown:Boolean(document.querySelector('[data-text-structure-export-md]')),json:Boolean(document.querySelector('[data-text-structure-export-json]')),insert:Boolean(document.querySelector('[data-text-structure-insert]')),content:document.querySelector('.text-structure-preview-content')?.innerText||'',body:document.querySelector('[data-text-content]')?.value||''}))()");
    check("预览、Markdown、JSON 和显式插入入口齐全", previewState.open && previewState.markdown && previewState.json && previewState.insert && previewState.content.includes("第一章 浮城") && previewState.body === beforePreview, previewState);
    await cdp.evaluate("document.querySelector('[data-text-structure-insert]')?.click();true"); await wait(900);
    const afterInsert = await cdp.evaluate("document.querySelector('[data-text-content]')?.value||''");
    check("只在人工确认后才把结构稿插入正文", afterInsert.length > beforePreview.length && afterInsert.includes("结构模板：小说") && afterInsert.includes("\n\n# 第一章 云城"), {before:beforePreview.length, after:afterInsert.length});

    const taskCount = await cdp.evaluate("window.lingframe.workbench.bootstrap().then(data=>(data.tasks||[]).length)");
    check("结构化编辑不创建生成任务", taskCount === fixture.initialTasks, {before:fixture.initialTasks, after:taskCount});

    await cdp.evaluate("location.reload();true"); await wait(800);
    await cdp.evaluate("document.querySelector('[data-page=text]')?.click();true"); await wait(350);
    await cdp.evaluate(`document.querySelector('[data-text-select=${JSON.stringify(fixture.novelId)}]')?.click();true`); await wait(400);
    await cdp.evaluate("document.querySelector('[data-text-assist-tab=structure]')?.click();true"); await wait(120);
    const recovered = await cdp.evaluate(`(()=>{const value=window.lingframeTextStructureBatchE.getDocument(${JSON.stringify(fixture.novelId)});return{outline:value?.outline?.length,characters:value?.characters?.length,world:value?.world?.length,timeline:value?.timeline?.length,versions:value?.versions?.length,tree:document.querySelectorAll('[data-text-structure-select-node]').length,body:document.querySelector('[data-text-content]')?.value||''}})()`);
    check("重启后结构、快照和经确认的正文均恢复", recovered.outline === 2 && recovered.characters === 1 && recovered.world === 1 && recovered.timeline === 1 && recovered.versions === 1 && recovered.tree === 2 && recovered.body.includes("结构模板：小说"), recovered);

    await cdp.evaluate(`document.querySelector('[data-text-select=${JSON.stringify(fixture.promptId)}]')?.click();true`); await wait(350);
    await cdp.evaluate("document.querySelector('[data-text-assist-tab=structure]')?.click();true"); await wait(100);
    const promptLegacy = await cdp.evaluate(`(()=>({template:document.querySelector('[data-text-structure-template]')?.value||'',stored:window.lingframeTextStructureBatchE.getDocument(${JSON.stringify(fixture.promptId)}),body:document.querySelector('[data-text-content]')?.value||''}))()`);
    check("其他旧类型会话按 type 平滑打开", promptLegacy.template === "prompt" && promptLegacy.stored === null && promptLegacy.body === "旧提示词正文", promptLegacy);

    const runtimeErrors = await cdp.evaluate("window.__batchEErrors||[]");
    check("批次 E 运行期无未处理异常", runtimeErrors.length === 0, runtimeErrors);
    await cdp.evaluate(`document.querySelector('[data-text-select=${JSON.stringify(fixture.novelId)}]')?.click();true`); await wait(300);
    await cdp.evaluate("document.querySelector('[data-text-assist-tab=structure]')?.click();document.querySelector('[data-text-structure-mode=outline]')?.click();true"); await wait(120);
    const screenshot = await cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-structure-batch-e-runtime.png"), Buffer.from(screenshot.data, "base64"));
    await cdp.evaluate(`(()=>{const original=${JSON.stringify(originalStructure)};if(original===null)localStorage.removeItem(${JSON.stringify(structureKey)});else localStorage.setItem(${JSON.stringify(structureKey)},original);return true})()`);
  } finally {
    try { cdp?.close(); } catch {}
    try { child?.kill(); } catch {}
    await wait(600); restore();
  }
  const failed = checks.filter(item => !item.ok);
  const report = {test:"text-structure-batch-e-runtime", timestamp:new Date().toISOString(), port, total:checks.length, passed:checks.length - failed.length, failed:failed.length, checks};
  const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-structure-batch-e-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { try { child?.kill(); } catch {} restore(); console.error(error.stack || error); process.exitCode = 1; });
