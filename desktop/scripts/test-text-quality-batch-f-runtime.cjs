"use strict";
const fs = require("fs");
const path = require("path");
const {spawn} = require("child_process");
const {WebSocket} = require("undici");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const userData = path.join(root, ".runtime-text-contract-user-data");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9564);
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
  throw new Error("批次 F 隔离 Electron 页面未启动");
}

async function connect(page) {
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 15000);
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
  const content = "云汐披着白发斗篷进入城门。她迫不急待地说这是国家级、100%有效的唯一产品。。\n钥匙已经丢失。\n她随后拿出钥匙打开房门。   \n\n\n\n最后一句使用英文,标点。";
  const conversation = bridge.createConversation({projectId, title:"批次 F 检查导出验收", type:"剧本", content});
  return {tenantId, projectId, conversationId:conversation.id, content, initialTasks:(data.tasks || []).length};
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
    for (let index = 0; index < 80; index += 1) {
      moduleReady = await cdp.evaluate("Boolean(window.lingframeTextQualityCore&&window.lingframeTextQualityBatchF&&window.lingframeTextStructureBatchE)");
      if (moduleReady) break;
      await wait(100);
    }
    if (!moduleReady) throw new Error("批次 F 质量检查模块未完成加载");
    await cdp.evaluate("(()=>{window.__batchFErrors=[];window.addEventListener('error',event=>window.__batchFErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener('unhandledrejection',event=>window.__batchFErrors.push(String(event.reason?.stack||event.reason)));return true})()");
    const scope = await cdp.evaluate("(async()=>{const identity=await window.lingframe.identity.status();const tenantId=String(identity?.tenantId||'local');return{tenantId,key:`${window.lingframeTextStructureCore.STORAGE_PREFIX}.${encodeURIComponent(tenantId)}`}})()");
    structureKey = scope.key;
    originalStructure = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(structureKey)})`);
    const seeded = await cdp.evaluate(`(()=>{const core=window.lingframeTextStructureCore;const doc=core.createDocument({tenantId:${JSON.stringify(fixture.tenantId)},projectId:${JSON.stringify(fixture.projectId)},conversationId:${JSON.stringify(fixture.conversationId)},type:'剧本'});doc.templateId='script';doc.derivedFromType=false;const a=core.addOutlineNode(doc,{title:'城门',fields:{sceneHeading:'内 · 云城 · 日',characters:'云汐、陌生人',location:'云城',action:'云汐进入城门'}});core.addOutlineNode(doc,{title:'城门',fields:{sceneHeading:'外 · 港口 · 夜',characters:'云汐',location:'港口',action:'云汐离开'}});core.addEntity(doc,'characters',{name:'云汐',role:'主角',appearance:'黑发蓝眼'});core.addEntity(doc,'timeline',{label:'抵达',time:'第3天',location:'云城',participants:'云汐'});core.addEntity(doc,'timeline',{label:'回忆',time:'第1天',location:'旧城',participants:'陌生人'});localStorage.setItem(${JSON.stringify(structureKey)},JSON.stringify({version:core.VERSION,documents:[doc],updatedAt:new Date().toISOString()}));return{outline:doc.outline.length,characters:doc.characters.length,timeline:doc.timeline.length}})()`);
    check("批次 F 测试结构夹具已按原项目和会话建立", seeded.outline === 2 && seeded.characters === 1 && seeded.timeline === 2, seeded);
    await cdp.evaluate("location.reload();true"); await wait(900);
    await cdp.evaluate("document.querySelector('[data-page=text]')?.click();true"); await wait(400);
    await cdp.evaluate(`document.querySelector('[data-text-select=${JSON.stringify(fixture.conversationId)}]')?.click();true`); await wait(500);

    const loaded = await cdp.evaluate("(()=>({owner:window.lingframeTextQualityBatchF?.ownsQualityAndExport===true,core:Boolean(window.lingframeTextQualityCore),categories:window.lingframeTextQualityBatchF?.categories?.length||0,formats:window.lingframeTextQualityBatchF?.formats?.length||0,tabs:document.querySelectorAll('[data-text-assist-tab]').length,qualityTab:Boolean(document.querySelector('[data-text-assist-tab=quality]')),central:document.querySelector('[data-text-export]')?.textContent||'',body:document.querySelector('[data-text-content]')?.value||'',structure:window.lingframeTextStructureBatchE.getDocument(document.querySelector('[data-text-conversation-id]')?.dataset.textConversationId)}))()");
    check("批次 F 模块、四类检查、五类导出和入口真实加载", loaded.owner && loaded.core && loaded.categories === 4 && loaded.formats === 5 && loaded.qualityTab && loaded.central === "检查/导出", loaded);
    check("原正文和原结构按同一 conversation 加载", loaded.body === fixture.content && loaded.structure?.conversationId === fixture.conversationId && loaded.structure?.projectId === fixture.projectId, {body:loaded.body, structure:loaded.structure});

    await cdp.evaluate("document.querySelector('[data-text-export]')?.click();true"); await wait(150);
    const panel = await cdp.evaluate("(()=>({active:document.querySelector('[data-text-assist-tab=quality]')?.classList.contains('on'),visible:!document.querySelector('[data-text-assist-body=quality]')?.classList.contains('is-hidden'),options:document.querySelectorAll('[data-text-quality-category]').length,exports:document.querySelectorAll('[data-text-quality-export]').length,focus:document.activeElement?.hasAttribute('data-text-quality-export-heading')}))()");
    check("中央检查导出入口真实点击后打开右侧面板", panel.active && panel.visible && panel.options === 4 && panel.exports === 5 && panel.focus, panel);

    const beforeCheck = await cdp.evaluate("document.querySelector('[data-text-content]')?.value||''");
    await cdp.evaluate("document.querySelector('[data-text-quality-run]')?.click();true"); await wait(180);
    const report = await cdp.evaluate(`window.lingframeTextQualityBatchF.getReport(${JSON.stringify(fixture.conversationId)})`);
    const afterCheck = await cdp.evaluate("document.querySelector('[data-text-content]')?.value||''");
    const issueCards = await cdp.evaluate("document.querySelectorAll('[data-text-quality-issue]').length");
    const reportCodes = new Set((report?.issues || []).map(item => item.code));
    check("四类检查真实运行并覆盖人物时间线场景道具错字格式和风险", report?.categories?.length === 4 && ["timeline-order", "unknown-character-reference", "scene-location", "prop-state", "character-appearance", "common-typo", "repeat-punctuation", "ad-absolute", "ad-guarantee"].every(code => reportCodes.has(code)), {counts:report?.counts, codes:[...reportCodes]});
    check("检查只生成定位卡且不修改正文", beforeCheck === afterCheck && issueCards === report.counts.total, {before:beforeCheck.length, after:afterCheck.length, cards:issueCards, total:report.counts.total});

    const typoIndex = report.issues.findIndex(item => item.code === "common-typo");
    await cdp.evaluate(`document.querySelectorAll('[data-text-quality-issue]')[${typoIndex}]?.click();true`); await wait(120);
    const located = await cdp.evaluate("(()=>{const area=document.querySelector('[data-text-content]');return{active:document.activeElement===area,selected:area?.value.slice(area.selectionStart,area.selectionEnd)||'',body:area?.value||''}})()");
    check("点击正文问题卡可恢复编辑器焦点并精确选择原词", located.active && located.selected === "迫不急待" && located.body === fixture.content, located);

    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,altKey:true,bubbles:true}));true"); await wait(100);
    const shortcut = await cdp.evaluate("(()=>({active:document.querySelector('[data-text-assist-tab=quality]')?.classList.contains('on'),focus:document.activeElement?.hasAttribute('data-text-quality-export-heading')}))()");
    check("Ctrl+Alt+E 可打开导出区域并管理焦点", shortcut.active && shortcut.focus, shortcut);
    await cdp.evaluate("(()=>{const area=document.querySelector('[data-text-content]');area.focus();area.dispatchEvent(new KeyboardEvent('keydown',{key:'F6',bubbles:true}));return document.activeElement!==area})()");
    const f6Focus = await cdp.evaluate("document.activeElement?.outerHTML?.slice(0,180)||''");
    check("F6 可在目录、标题、正文、操作和协作区域间移动焦点", Boolean(f6Focus) && !f6Focus.includes("data-text-content"), f6Focus);

    await cdp.evaluate("(()=>{window.__batchFDownloads=[];window.__batchFCreateObjectURL=URL.createObjectURL;window.__batchFRevokeObjectURL=URL.revokeObjectURL;window.__batchFAnchorClick=HTMLAnchorElement.prototype.click;URL.createObjectURL=blob=>{window.__batchFDownloads.push({type:blob.type,size:blob.size,url:`blob:batch-f-${window.__batchFDownloads.length}`});return window.__batchFDownloads.at(-1).url};URL.revokeObjectURL=()=>{};HTMLAnchorElement.prototype.click=function(){const item=window.__batchFDownloads.at(-1);if(item){item.filename=this.download;item.href=this.href}};document.querySelectorAll('[data-text-quality-export]').forEach(button=>button.click());return true})()"); await wait(100);
    const downloads = await cdp.evaluate("window.__batchFDownloads||[]");
    check("五种格式均由人工点击触发本地导出", downloads.length === 5 && downloads.some(item => item.filename?.endsWith(".txt")) && downloads.some(item => item.filename?.endsWith(".md")) && downloads.some(item => item.filename?.endsWith(".json")) && downloads.some(item => item.filename?.endsWith(".screenplay.txt")) && downloads.some(item => item.filename?.endsWith(".storyboard.csv")), downloads);
    await cdp.evaluate("(()=>{URL.createObjectURL=window.__batchFCreateObjectURL;URL.revokeObjectURL=window.__batchFRevokeObjectURL;HTMLAnchorElement.prototype.click=window.__batchFAnchorClick;return true})()");
    const secureJson = await cdp.evaluate(`(()=>{const result=window.lingframeTextQualityBatchF.buildExport('json',{title:'安全导出',type:'剧本',content:'正文',projectId:${JSON.stringify(fixture.projectId)},conversationId:${JSON.stringify(fixture.conversationId)},structure:{templateId:'script',fields:{format:'电影',apiKey:'secret'},outline:[],characters:[],world:[],timeline:[],variables:[]},apiKey:'outer-secret',cookie:'sid=secret',accountProfile:{token:'secret'}});return{filename:result.filename,parsed:JSON.parse(result.content),raw:result.content}})()`);
    check("JSON 使用字段白名单且不含认证配置", secureJson.parsed.projectId === fixture.projectId && secureJson.parsed.conversationId === fixture.conversationId && !/apiKey|outer-secret|sid=secret|accountProfile|authorization|baseUrl/.test(secureJson.raw), secureJson);

    await cdp.evaluate("document.querySelector('[data-text-assist-tab=quality]')?.click();document.querySelector('[data-text-quality-run]')?.click();true"); await wait(120);
    const structureReport = await cdp.evaluate(`window.lingframeTextQualityBatchF.getReport(${JSON.stringify(fixture.conversationId)})`);
    const timelineIndex = structureReport.issues.findIndex(item => item.code === "timeline-order");
    await cdp.evaluate(`document.querySelectorAll('[data-text-quality-issue]')[${timelineIndex}]?.click();true`); await wait(220);
    const routed = await cdp.evaluate("(()=>({structure:document.querySelector('[data-text-assist-tab=structure]')?.classList.contains('on'),mode:document.querySelector('[data-text-structure-mode=timeline]')?.classList.contains('on'),label:document.querySelector('[data-text-structure-timeline-field=\"label\"]')?.value||''}))()");
    check("结构问题卡回到原结构创作记录而不修改正文", routed.structure && routed.mode && routed.label === "回忆", routed);

    await cdp.evaluate("document.querySelector('[data-text-assist-tab=quality]')?.click();document.querySelector('[data-text-quality-run]')?.click();(()=>{const area=document.querySelector('[data-text-content]');area.value+='\\n新增段落';area.dispatchEvent(new Event('input',{bubbles:true}));return true})();"); await wait(80);
    const stale = await cdp.evaluate("(()=>({stale:document.querySelector('.text-quality-summary')?.classList.contains('is-stale'),note:document.querySelector('.text-quality-summary p')?.textContent||'',body:document.querySelector('[data-text-content]')?.value||''}))()");
    check("正文变化后旧检查结果明确标记过期且不回写旧正文", stale.stale && stale.note.includes("已过期") && stale.body.endsWith("新增段落"), stale);

    await cdp.send("Emulation.setDeviceMetricsOverride", {width:720, height:820, deviceScaleFactor:2, mobile:false}); await wait(180);
    await cdp.evaluate("(()=>{const area=document.querySelector('[data-text-content]');area.focus();document.dispatchEvent(new KeyboardEvent('keydown',{key:'e',ctrlKey:true,altKey:true,bubbles:true}));return true})()"); await wait(120);
    const responsive = await cdp.evaluate("(()=>{const assist=document.querySelector('.text-assist');const card=document.querySelector('[data-text-quality-export]');return{width:innerWidth,dpr:devicePixelRatio,overlay:assist?.classList.contains('text-quality-overlay'),position:getComputedStyle(assist).position,visible:card?getComputedStyle(card).display!=='none':false,minHeight:card?.getBoundingClientRect().height||0,highDpi:matchMedia('(min-resolution:144dpi)').matches}})()");
    check("窄屏使用独立覆盖层且高 DPI 点击区保持可用", responsive.width === 720 && responsive.dpr === 2 && responsive.overlay && responsive.position === "fixed" && responsive.visible && responsive.minHeight >= 44 && responsive.highDpi, responsive);
    await cdp.evaluate("document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));true"); await wait(80);
    const escaped = await cdp.evaluate("(()=>({overlay:document.querySelector('.text-assist')?.classList.contains('text-quality-overlay'),focus:document.activeElement?.hasAttribute('data-text-content')}))()");
    check("窄屏 Escape 关闭覆盖层并恢复原编辑焦点", !escaped.overlay && escaped.focus, escaped);
    await cdp.send("Emulation.clearDeviceMetricsOverride"); await wait(150);
    await wait(900);

    const taskCount = await cdp.evaluate("window.lingframe.workbench.bootstrap().then(data=>(data.tasks||[]).length)");
    check("本地检查和导出不创建生成任务", taskCount === fixture.initialTasks, {before:fixture.initialTasks, after:taskCount});
    const runtimeErrors = await cdp.evaluate("window.__batchFErrors||[]");
    check("批次 F 运行期无未处理异常", runtimeErrors.length === 0, runtimeErrors);

    await cdp.evaluate("location.reload();true"); await wait(850);
    await cdp.evaluate("document.querySelector('[data-page=text]')?.click();true"); await wait(350);
    await cdp.evaluate(`document.querySelector('[data-text-select=${JSON.stringify(fixture.conversationId)}]')?.click();true`); await wait(400);
    const recovered = await cdp.evaluate("(()=>({module:Boolean(window.lingframeTextQualityBatchF),entry:document.querySelector('[data-text-export]')?.textContent||'',structure:Boolean(window.lingframeTextStructureBatchE.getDocument(document.querySelector('[data-text-conversation-id]')?.dataset.textConversationId)),body:document.querySelector('[data-text-content]')?.value||''}))()");
    check("应用重载后批次 F 入口、原会话结构和正文均可恢复", recovered.module && recovered.entry === "检查/导出" && recovered.structure && recovered.body.includes("批次") === false && recovered.body.includes("新增段落"), recovered);
    await cdp.evaluate("document.querySelector('[data-text-export]')?.click();document.querySelector('[data-text-quality-run]')?.click();true"); await wait(160);
    const screenshot = await cdp.send("Page.captureScreenshot", {format:"png", captureBeyondViewport:false});
    const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-quality-batch-f-runtime.png"), Buffer.from(screenshot.data, "base64"));
    await cdp.evaluate(`(()=>{const original=${JSON.stringify(originalStructure)};if(original===null)localStorage.removeItem(${JSON.stringify(structureKey)});else localStorage.setItem(${JSON.stringify(structureKey)},original);return true})()`);
  } finally {
    try { cdp?.close(); } catch {}
    try { child?.kill(); } catch {}
    await wait(650); restore();
  }
  const failed = checks.filter(item => !item.ok);
  const report = {test:"text-quality-batch-f-runtime", timestamp:new Date().toISOString(), port, total:checks.length, passed:checks.length - failed.length, failed:failed.length, checks};
  const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true}); fs.writeFileSync(path.join(logDir, "text-quality-batch-f-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { try { child?.kill(); } catch {} restore(); console.error(error.stack || error); process.exitCode = 1; });
