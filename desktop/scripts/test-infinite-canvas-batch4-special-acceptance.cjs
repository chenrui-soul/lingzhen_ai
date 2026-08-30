"use strict";

const {app, BrowserWindow} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const logDir = path.join(root, "scripts", "log");
const checks = [];
const messages = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, ok, detail = null) => checks.push({name, ok:Boolean(ok), detail});

app.setPath("userData", path.join(os.tmpdir(), `lingframe-canvas-batch4-${process.pid}`));
app.commandLine.appendSwitch("disable-gpu");

async function evaluate(win, expression) { return win.webContents.executeJavaScript(expression, true); }
async function waitFor(win, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { if (await evaluate(win, expression)) return true; await wait(60); }
  return false;
}
async function selectCanvas(win, canvasId) {
  return evaluate(win, `(()=>{const select=document.querySelector('[data-lfc-canvas-select]');if(!select)return false;select.value=${JSON.stringify(canvasId)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}
async function rect(win, selector) {
  return evaluate(win, `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
}
async function mouse(win, type, point, options = {}) {
  const button = options.button || "left";
  const modifiers = (options.modifiers || []).reduce((bits, item) => bits | ({alt:1, control:2, meta:4, shift:8}[item] || 0), 0);
  const buttons=type==="mousePressed"?1:type==="mouseReleased"?0:button==="none"?0:1;
  return win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type, x:Math.round(point.x), y:Math.round(point.y), button, buttons, clickCount:1, modifiers});
}
async function click(win, selector, options = {}) {
  const box = await rect(win, selector);
  if (!box || box.width <= 0 || box.height <= 0) throw new Error(`无法点击：${selector}`);
  const point = {x:box.left + box.width * (options.xRatio ?? .5), y:box.top + box.height * (options.yRatio ?? .5)};
  await mouse(win, "mouseMoved", point, {button:"none"});
  await mouse(win, "mousePressed", point, options);
  await wait(18);
  await mouse(win, "mouseReleased", point, options);
  await wait(options.wait ?? 90);
  return {point, box};
}
async function drag(win, start, end, options = {}) {
  const steps = options.steps || 12;
  await mouse(win, "mouseMoved", start, {button:"none", modifiers:options.modifiers});
  await mouse(win, "mousePressed", start, options);
  for (let i = 1; i <= steps; i += 1) {
    const point = {x:start.x + (end.x - start.x) * i / steps, y:start.y + (end.y - start.y) * i / steps};
    await mouse(win, "mouseMoved", point, options);
    await wait(12);
  }
  await mouse(win, "mouseReleased", end, options);
  await wait(options.wait ?? 120);
}
async function dragNodeWithSample(win, selector, delta) {
  const box = await rect(win, selector);
  if (!box) throw new Error(`找不到节点：${selector}`);
  const start = {x:box.left + Math.min(90, box.width / 2), y:box.top + 16};
  const first = {x:start.x + delta.x / 3, y:start.y + delta.y / 3};
  await mouse(win, "mouseMoved", start, {button:"none"});
  await mouse(win, "mousePressed", start);
  await mouse(win, "mouseMoved", first, {button:"left"});
  await wait(80);
  const during = await evaluate(win, "({editorHidden:document.querySelector('.lfc-node-composer-host')?.classList.contains('lfc-editor-hidden-on-drag')===true,stageDragging:document.querySelector('.lfc-stage')?.classList.contains('lfc-node-dragging')===true})");
  const end={x:start.x+delta.x,y:start.y+delta.y};
  for(let index=2;index<=8;index+=1){await mouse(win,"mouseMoved",{x:first.x+(end.x-first.x)*index/8,y:first.y+(end.y-first.y)*index/8},{button:"left"});await wait(12);}
  await mouse(win,"mouseReleased",end);
  await wait(120);
  return during;
}

function report(extra = {}) {
  fs.mkdirSync(logDir, {recursive:true});
  const failed = checks.filter(item => !item.ok);
  const result = {test:"infinite-canvas-batch4-special-acceptance",at:new Date().toISOString(),total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks,messages,...extra};
  fs.writeFileSync(path.join(logDir, "infinite-canvas-batch4-special-acceptance.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`INFINITE_CANVAS_BATCH4_SPECIAL_ACCEPTANCE ${result.passed}/${result.total}`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
  return failed.length;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show:true,
    width:1600,
    height:1000,
    webPreferences:{preload:path.join(__dirname, "test-infinite-canvas-g5-runtime-preload.cjs"),contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}
  });
  win.webContents.debugger.attach("1.3");
  win.webContents.on("console-message", (_, level, message, line, sourceId) => messages.push({level,message,line,sourceId}));
  try {
    await win.loadFile(path.join(root, "src", "renderer", "index.html"));
    win.show();
    win.focus();
    win.webContents.focus();
    await waitFor(win, "Boolean(window.LingframeCanvasCore && document.querySelector('[data-page=\"canvas\"]'))");

    const seed = await evaluate(win, `(()=>{
      const core=window.LingframeCanvasCore, now=new Date().toISOString();
      const node=(kind,x,y,id,title,extra={})=>core.makeNode(kind,{x,y},{id,title,instruction:title,status:"idle",...extra});
      const text=node("text",600,180,"batch4-text","批次四文本");
      const video=node("video-generation",930,180,"batch4-video","批次四视频",{route:{channel:"doubao",accountId:"desktop-g5",accountName:"G5 测试账号",ratio:"16:9",duration:"10s"}});
      const image=node("image-input",600,520,"batch4-image","批次四图片",{status:"completed",output:{type:"image",assetId:"asset-image-g5"},refs:{assetIds:["asset-image-g5"],assetRoles:{"asset-image-g5":"character"},jobIds:["task-running-g5"],conversationIds:[]}});
      const canvas={id:"batch4-nodes",title:"第 4 批真实交互验收",projectId:"project-canvas-g5",templateId:"blank",status:"draft",createdAt:now,updatedAt:now,versions:[],document:{schemaVersion:core.VERSION,nodes:[text,video,image],edges:[core.makeEdge(text.id,video.id,{id:"batch4-edge"})],groups:[],viewport:{x:0,y:0,zoom:1},metadata:{templateId:"blank"}}};
      const empty={id:"batch4-empty",title:"第 4 批首屏验收",projectId:"project-canvas-g5",templateId:"blank",status:"draft",createdAt:now,updatedAt:now,versions:[],assetScope:{version:1,localAssetIds:["asset-image-g5","asset-video-g5","asset-audio-g5"],importedAssetIds:[],generatedAssetIds:[],removedAssetIds:[],references:{"asset-image-g5":{role:"character",order:0},"asset-video-g5":{role:"motion",order:1},"asset-audio-g5":{role:"voice",order:2}},updatedAt:now},document:{schemaVersion:core.VERSION,nodes:[],edges:[],groups:[],viewport:{x:0,y:0,zoom:1},metadata:{templateId:"blank"}}};
      const store={version:2,activeId:canvas.id,toolMode:"select",leftCollapsed:false,inspectorCollapsed:false,defaultRoute:{channel:"model-gateway",providerId:"provider-g5",modelId:"text-g5"},canvasUi:{},canvases:[canvas,empty]};
      localStorage.setItem("lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5",JSON.stringify(store));
      return {nodes:canvas.document.nodes.length,emptyNodes:empty.document.nodes.length};
    })()`);
    check("批次四夹具含节点画布和空白创作台", seed.nodes===3 && seed.emptyNodes===0, seed);

    await click(win, "[data-page='canvas']");
    const ready = await waitFor(win, "document.querySelectorAll('.lfc-node').length===3 && document.querySelector('[data-lfc-mounted=\"1\"]')", 12000);
    check("真实页面完成无限画布装载", ready);
    if (!ready) throw new Error("画布未完成装载");
    await click(win,"[data-lfc-fit]");
    await wait(180);

    const view = await rect(win, "[data-lfc-viewport]");
    const blankPoint=await evaluate(win,`(()=>{const r=document.querySelector('[data-lfc-viewport]').getBoundingClientRect();for(let y=Math.min(r.bottom-80,r.top+420);y>r.top+90;y-=36){for(let x=Math.min(r.right-400,r.left+940);x>r.left+270;x-=46){const hit=document.elementFromPoint(x,y);if(hit?.closest?.('[data-lfc-viewport]')&&!hit.closest('.lfc-node,.lfc-node-group,.lfc-edge,.lfc-canvas-tools,.lfc-zoom,.lfc-status,.lfc-runs-dock,.lfc-minimap,.lfc-empty-hero,.lfc-library,.lfc-node-composer-host'))return{x,y,tag:hit.tagName,className:String(hit.className||'')}}}return null})()`);
    if(!blankPoint) throw new Error("未找到画布内部空白区域");
    const beforePan = await evaluate(win, "(()=>{const value=JSON.parse(localStorage.getItem('lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5'));return value.canvases.find(item=>item.id==='batch4-nodes').document.viewport})()");
    await drag(win,blankPoint,{x:blankPoint.x+60,y:blankPoint.y+35});
    await wait(320);
    const afterPan = await evaluate(win, "(()=>{const value=JSON.parse(localStorage.getItem('lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5'));const canvas=value.canvases.find(item=>item.id==='batch4-nodes');return{viewport:canvas.document.viewport,world:document.querySelector('[data-lfc-world]')?.style.transform||'',selected:document.querySelectorAll('.lfc-node.selected').length,selection:window.getSelection()?.toString()||''}})()");
    check("选择模式空白左拖执行画布平移", afterPan.world!=="translate(0px, 0px) scale(1)", {blankPoint,beforePan,afterPan});
    check("空白平移不会产生节点选区或文本全选", afterPan.selected===0 && afterPan.selection==="", afterPan);

    const nodeBoxes = await evaluate(win, `(()=>{const ids=['batch4-text','batch4-video'];return ids.map(id=>{const r=document.querySelector('[data-node-id="'+id+'"]').getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom}})})()`);
    const box = await rect(win, "[data-lfc-viewport]");
    const selectStart={x:Math.max(box.left+260,Math.min(...nodeBoxes.map(item=>item.left))-20),y:Math.max(box.top+70,Math.min(...nodeBoxes.map(item=>item.top))-20)};
    const selectEnd={x:Math.min(box.right-10,Math.max(...nodeBoxes.map(item=>item.right))+20),y:Math.min(box.bottom-10,Math.max(...nodeBoxes.map(item=>item.bottom))+20)};
    await drag(win,selectStart,selectEnd,{modifiers:["shift"],steps:14});
    const selected=await evaluate(win,"[...document.querySelectorAll('.lfc-node.selected')].map(item=>item.dataset.nodeId).sort()");
    check("Shift 加真实鼠标框选只选中目标节点", JSON.stringify(selected)===JSON.stringify(["batch4-text","batch4-video"]), {nodeBoxes,selectStart,selectEnd,selected});

    await click(win,"[data-node-id='batch4-video'] .lfc-node-preview");
    if(!(await waitFor(win,"Boolean(document.querySelector('.lfc-node-composer-host'))",900))) await click(win,"[data-node-edit='batch4-video']");
    await waitFor(win,"Boolean(document.querySelector('.lfc-node-composer-host'))",3000);
    await waitFor(win,"Boolean(document.querySelector('.lfc-node-composer-host'))",3000);
    const openEditor=await evaluate(win,"Boolean(document.querySelector('.lfc-node-composer-host'))");
    const duringOpen=await dragNodeWithSample(win,"[data-node-id='batch4-video'] .lfc-node-head",{x:72,y:42});
    const afterOpen=await evaluate(win,"({editor: Boolean(document.querySelector('.lfc-node-composer-host')),hidden:document.querySelector('.lfc-node-composer-host')?.classList.contains('lfc-editor-hidden-on-drag')===true})");
    check("已打开编辑器时拖动节点过程自动隐藏", openEditor && duringOpen.editorHidden && duringOpen.stageDragging, {openEditor,duringOpen});
    check("已打开编辑器时拖动结束自动恢复", afterOpen.editor===true && afterOpen.hidden===false, afterOpen);
    if(await evaluate(win,"Boolean(document.querySelector('[data-lfc-close-composer]'))"))await click(win,"[data-lfc-close-composer]");
    const noEditorDuring=await dragNodeWithSample(win,"[data-node-id='batch4-text'] .lfc-node-head",{x:58,y:32});
    const noEditorAfter=await evaluate(win,"Boolean(document.querySelector('.lfc-node-composer-host'))");
    check("未打开编辑器时拖动过程不强制打开编辑器", noEditorDuring.editorHidden===false && noEditorAfter===false, {noEditorDuring,noEditorAfter});

    const imageKeyBefore=await evaluate(win,"document.querySelector('[data-node-id=\"batch4-image\"] [data-lfc-node-content-key]')?.dataset.lfcNodeContentKey||''");
    const imageCard=await rect(win,"[data-node-id='batch4-image'] .lfc-node-media-frame");
    const imageNode=await rect(win,"[data-node-id='batch4-image']");
    await click(win,"[data-node-id='batch4-image'] .lfc-node-media-frame");
    const preview=await evaluate(win,"({host:Boolean(document.querySelector('.lfc-asset-preview-host')),asset:document.querySelector('.lfc-asset-viewer')?.dataset.previewAsset||document.querySelector('[data-lfc-preview-asset]')?.dataset.lfcPreviewAsset||''})");
    check("图片节点按素材比例渲染并可真实点击预览", imageCard&&imageNode&&imageNode.height>=150&&preview.host, {imageCard,imageNode,preview});
    await evaluate(win,"window.__lingframeG5.emitLiveStatus({taskId:'task-running-g5',state:'generating',progress:61});true");
    await wait(120);
    const imageKeyAfter=await evaluate(win,"document.querySelector('[data-node-id=\"batch4-image\"] [data-lfc-node-content-key]')?.dataset.lfcNodeContentKey||''");
    const imageStillPresent=await evaluate(win,"Boolean(document.querySelector('[data-node-id=\"batch4-image\"] .lfc-node-media-frame'))");
    check("媒体节点状态刷新不清空或闪烁替换预览内容", imageKeyBefore===imageKeyAfter && imageStillPresent, {imageKeyBefore,imageKeyAfter,imageStillPresent});
    await evaluate(win,"document.querySelector('.lfc-asset-preview-host')?.remove();true");

    await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5',store=JSON.parse(localStorage.getItem(key));store.activeId='batch4-empty';localStorage.setItem(key,JSON.stringify(store));location.reload();return true})()`);
    await waitFor(win,"Boolean(document.querySelector('[data-page=\"canvas\"]'))",12000);
    await click(win,"[data-page='canvas']");
    await wait(180);
    await selectCanvas(win,"batch4-empty");
    await waitFor(win,"Boolean(document.querySelector('.lfc-empty-canvas'))",12000);
    const emptyState=await evaluate(win,"({title:document.querySelector('.lfc-empty-canvas h2')?.textContent?.trim()||'',hint:document.querySelector('.lfc-empty-canvas p')?.textContent?.trim()||'',creator:Boolean(document.querySelector('.lfc-creator-studio')),form:Boolean(document.querySelector('[data-lfc-empty-form]')),canvas:document.querySelector('[data-lfc-canvas-select]')?.value||'',nodes:document.querySelectorAll('.lfc-node').length})");
    check("空白画布只显示极简品牌入口", emptyState.title==="灵感，即刻成帧"&&emptyState.hint==="右击画布空白处创建节点"&&!emptyState.creator&&!emptyState.form&&emptyState.nodes===0, emptyState);
    const emptyPoint=await evaluate(win,"(()=>{const r=document.querySelector('[data-lfc-viewport]').getBoundingClientRect();return{x:r.left+r.width*.62,y:r.top+r.height*.46}})()");
    await mouse(win,"mouseMoved",emptyPoint,{button:"none"});
    await mouse(win,"mousePressed",emptyPoint,{button:"right"});
    await mouse(win,"mouseReleased",emptyPoint,{button:"right"});
    await wait(100);
    const menu=await evaluate(win,"({visible:Boolean(document.querySelector('.lfc-quick-menu')),items:document.querySelectorAll('.lfc-quick-menu [data-menu-kind]').length,emptyPointer:getComputedStyle(document.querySelector('.lfc-empty-canvas')).pointerEvents})");
    check("空白画布右键打开节点创建菜单", menu.visible&&menu.items>0&&menu.emptyPointer==="none", menu);
    await click(win,".lfc-quick-menu [data-menu-kind]");
    const afterCreate=await evaluate(win,"({nodes:document.querySelectorAll('.lfc-node').length,empty:Boolean(document.querySelector('.lfc-empty-canvas')),selected:document.querySelectorAll('.lfc-node.selected').length})");
    check("右键菜单创建节点后进入正常编辑画布", afterCreate.nodes===1&&!afterCreate.empty&&afterCreate.selected===1, afterCreate);

    const fatal=messages.filter(item=>item.level>=3||(/Uncaught|ReferenceError/.test(item.message||"")&&/infinite-canvas|canvas-flow-core/.test(item.sourceId||"")));
    check("专项交互过程无画布渲染致命错误", fatal.length===0, fatal);
    process.exitCode=report();
  } catch (error) {
    check("批次四专项验收未异常中断", false, {message:error.message,stack:error.stack});
    process.exitCode=report({fatal:{message:error.message,stack:error.stack}});
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
    app.quit();
  }
}).catch(error => { console.error(error.stack || error); process.exitCode=1; app.quit(); });
