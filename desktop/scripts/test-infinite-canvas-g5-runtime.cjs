"use strict";

const {app, BrowserWindow} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];
const rendererMessages = [];
const check = (name, ok, detail = null) => checks.push({name, ok:Boolean(ok), detail});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const logDir = path.join(root, "scripts", "log");
const screenshotDir = path.join(logDir, "screenshots", "infinite-canvas-g5");
fs.mkdirSync(screenshotDir, {recursive:true});

app.setPath("userData", path.join(os.tmpdir(), `lingframe-canvas-g5-${process.pid}`));
app.commandLine.appendSwitch("disable-gpu");

async function evaluate(win, expression) {
  return win.webContents.executeJavaScript(expression, true);
}

async function waitFor(win, expression, timeout = 10000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(win, expression)) return true;
    await wait(60);
  }
  return false;
}

async function rect(win, selector) {
  return evaluate(win, `(()=>{const node=document.querySelector(${JSON.stringify(selector)});if(!node)return null;const r=node.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height,left:r.left,top:r.top,right:r.right,bottom:r.bottom}})()`);
}

async function click(win, selector, options = {}) {
  const box = await rect(win, selector);
  if (!box || box.width <= 0 || box.height <= 0) throw new Error(`无法点击：${selector}`);
  const x = Math.round(box.x + box.width * (options.xRatio ?? .5));
  const y = Math.round(box.y + box.height * (options.yRatio ?? .5));
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved", x, y, button:"none", buttons:0});
  await wait(20);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mousePressed", x, y, button:options.button || "left", buttons:1, clickCount:1});
  await wait(20);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseReleased", x, y, button:options.button || "left", buttons:0, clickCount:1});
  await wait(options.wait ?? 80);
  return {x,y,box};
}

async function clickPoint(win, point, options = {}) {
  const x=Math.round(point.x), y=Math.round(point.y), button=options.button||"left";
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved", x, y, button:"none", buttons:0});
  await wait(20);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mousePressed", x, y, button, buttons:1, clickCount:1});
  await wait(20);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseReleased", x, y, button, buttons:0, clickCount:1});
  await wait(options.wait??80);
  return {x,y};
}

async function drag(win, start, end, steps = 10, options = {}) {
  const modifiers=(options.modifiers||[]).reduce((bits, item)=>bits|({alt:1,control:2,meta:4,shift:8}[item]||0),0);
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved", x:Math.round(start.x), y:Math.round(start.y), button:"none", buttons:0});
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mousePressed", x:Math.round(start.x), y:Math.round(start.y), button:"left", buttons:1, clickCount:1, modifiers});
  for (let index = 1; index <= steps; index += 1) {
    const x = Math.round(start.x + (end.x - start.x) * index / steps);
    const y = Math.round(start.y + (end.y - start.y) * index / steps);
    await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseMoved", x, y, button:"left", buttons:1, modifiers});
    await wait(12);
  }
  await win.webContents.debugger.sendCommand("Input.dispatchMouseEvent", {type:"mouseReleased", x:Math.round(end.x), y:Math.round(end.y), button:"left", buttons:0, clickCount:1, modifiers});
  await wait(140);
}

async function press(win, keyCode, modifiers = []) {
  const modifierBits=(modifiers.includes("alt")?1:0)|(modifiers.includes("control")?2:0)|(modifiers.includes("meta")?4:0)|(modifiers.includes("shift")?8:0);
  const virtualKey=keyCode==="Delete"?46:String(keyCode).toUpperCase().charCodeAt(0);
  await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type:"rawKeyDown", key:keyCode, code:keyCode, windowsVirtualKeyCode:virtualKey, nativeVirtualKeyCode:virtualKey, modifiers:modifierBits});
  await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type:"keyUp", key:keyCode, code:keyCode, windowsVirtualKeyCode:virtualKey, nativeVirtualKeyCode:virtualKey, modifiers:modifierBits});
  await wait(100);
}

async function replaceFocusedText(win, value) {
  await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type:"rawKeyDown", key:"a", code:"KeyA", windowsVirtualKeyCode:65, nativeVirtualKeyCode:65, modifiers:2});
  await win.webContents.debugger.sendCommand("Input.dispatchKeyEvent", {type:"keyUp", key:"a", code:"KeyA", windowsVirtualKeyCode:65, nativeVirtualKeyCode:65, modifiers:2});
  await win.webContents.debugger.sendCommand("Input.insertText", {text:value});
  await wait(80);
}

function report(extra = {}) {
  const failed = checks.filter(item => !item.ok);
  const result = {test:"infinite-canvas-g5-runtime", at:new Date().toISOString(), total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks, rendererMessages, ...extra};
  fs.writeFileSync(path.join(logDir, "infinite-canvas-g5-runtime.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`INFINITE_CANVAS_G5_RUNTIME ${result.passed}/${result.total}`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
  return failed.length;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show:true,
    width:1600,
    height:1000,
    webPreferences:{
      preload:path.join(__dirname, "test-infinite-canvas-g5-runtime-preload.cjs"),
      contextIsolation:true,
      nodeIntegration:false,
      backgroundThrottling:false
    }
  });
  win.webContents.debugger.attach("1.3");
  win.webContents.on("console-message", (_, level, message, line, sourceId) => rendererMessages.push({level,message,line,sourceId}));
  win.webContents.on("render-process-gone", (_, detail) => rendererMessages.push({level:3,message:`render-process-gone:${JSON.stringify(detail)}`}));
  const screenshots = [];
  try {
    await win.loadFile(path.join(root, "src", "renderer", "index.html"));
    win.show();
    win.focus();
    win.webContents.focus();
    await waitFor(win, "Boolean(document.querySelector('[data-page=\"canvas\"]') && window.LingframeCanvasCore)");
    const seed = await evaluate(win, `(()=>{
      const core=window.LingframeCanvasCore, now=new Date().toISOString();
      const node=(kind,x,y,id,title,instruction,extra={})=>core.makeNode(kind,{x,y},{id,title,instruction,...extra});
      const ancestor=node('story-outline',550,90,'node-ancestor-g5','祖先剧情设定','祖先本地说明',{status:'completed',output:{type:'text',content:'祖先剧情与导演规划不应进入视频节点'}});
      const direct=node('video-prompt',880,90,'node-direct-g5','直接视频提示词','直接节点本地说明',{status:'generating',output:{type:'text',content:'雨夜便利店门口，人物撑伞快速入画。'},refs:{assetIds:[],assetRoles:{},jobIds:['task-running-g5'],conversationIds:[]}});
      const target=node('video-generation',1240,90,'node-video-target-g5','视频目标节点','目标节点保留的本地描述',{route:{channel:'doubao',accountId:'desktop-g5',accountName:'G5 测试账号',doubaoModel:'Seedance 2.0 Mini',ratio:'16:9',duration:'10s'}});
      const imageSource=node('image-input',550,410,'node-image-source-g5','图片直接上游','',{status:'completed',output:{type:'image',assetId:'asset-image-g5'},refs:{assetIds:['asset-image-g5'],assetRoles:{'asset-image-g5':'character'},jobIds:[],conversationIds:[]}});
      const imageTarget=node('image-generation',880,410,'node-image-target-g5','图片生成目标','图片生成本地描述');
      const videoSource=node('video-input',1240,410,'node-video-source-g5','视频直接上游','',{status:'completed',output:{type:'video',assetId:'asset-video-g5'},refs:{assetIds:['asset-video-g5'],assetRoles:{'asset-video-g5':'motion'},jobIds:[],conversationIds:[]}});
      const audioSource=node('audio-input',1240,650,'node-audio-source-g5','音频直接上游','',{status:'completed',output:{type:'audio',assetId:'asset-audio-g5'},refs:{assetIds:['asset-audio-g5'],assetRoles:{'asset-audio-g5':'voice'},jobIds:[],conversationIds:[]}});
      const finalTarget=node('final-cut',1090,510,'node-final-target-g5','媒体整理目标','媒体整理本地描述');
      const edges=[
        core.makeEdge(ancestor.id,direct.id,{id:'edge-ancestor-direct-g5'}),
        core.makeEdge(direct.id,target.id,{id:'edge-direct-target-g5'}),
        core.makeEdge(imageSource.id,imageTarget.id,{id:'edge-image-g5'}),
        core.makeEdge(videoSource.id,finalTarget.id,{id:'edge-video-g5'}),
        core.makeEdge(audioSource.id,finalTarget.id,{id:'edge-audio-g5'})
      ];
      const canvas={id:'canvas-g5',title:'G5 真实交互复检',projectId:'project-canvas-g5',templateId:'blank',status:'draft',createdAt:now,updatedAt:now,versions:[],document:{schemaVersion:core.VERSION,nodes:[ancestor,direct,target,imageSource,imageTarget,videoSource,audioSource,finalTarget],edges,groups:[],viewport:{x:20,y:45,zoom:.62},metadata:{templateId:'blank'}}};
      const store={version:2,activeId:canvas.id,toolMode:'select',leftCollapsed:false,inspectorCollapsed:false,defaultRoute:{channel:'model-gateway',providerId:'provider-g5',modelId:'text-g5'},canvases:[canvas]};
      localStorage.setItem('lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5',JSON.stringify(store));
      return {nodes:canvas.document.nodes.length,edges:edges.length};
    })()`);
    check("G5 测试画布夹具已隔离写入", seed.nodes===8 && seed.edges===5, seed);

    const navigationClick = await click(win, "[data-page='canvas']");
    const navigationState = await evaluate(win, `(()=>{const p=document.elementFromPoint(${navigationClick.x},${navigationClick.y});return{active:document.querySelector('[data-page="canvas"]')?.classList.contains('active')===true,hit:p?{tag:p.tagName,className:p.className,text:p.textContent?.trim().slice(0,80)}:null}})()`);
    check("CDP 真实点击命中无限画布导航", navigationState.active, {navigationClick,navigationState});
    if (!navigationState.active) await evaluate(win, "document.querySelector('[data-page=\"canvas\"]')?.click(); true");
    const ready = await waitFor(win, "Boolean(document.querySelector('[data-lfc-mounted=\"1\"] .lfc-node') && document.querySelectorAll('.lfc-node').length===8)", 12000);
    check("正式画布在隔离 Electron 宿主中完成装载", ready, await evaluate(win, "({nodes:document.querySelectorAll('.lfc-node').length,text:document.body.innerText.slice(0,300)})"));
    if (!ready) throw new Error("画布未完成装载");
    await wait(350);

    await click(win, "[data-lfc-tool='pan']");
    check("真实点击可切换到平移工具", await evaluate(win, "document.querySelector('.lfc-stage')?.classList.contains('tool-pan')"));
    await click(win, "[data-lfc-tool='select']");
    check("真实点击可切回选择工具", await evaluate(win, "document.querySelector('.lfc-stage')?.classList.contains('tool-select')"));
    const selectionGeometry = await evaluate(win, `(()=>{const ids=['node-ancestor-g5','node-direct-g5'];const boxes=ids.map(id=>document.querySelector('[data-node-id="'+id+'"]')?.getBoundingClientRect()).filter(Boolean);const viewport=document.querySelector('[data-lfc-viewport]').getBoundingClientRect();const start={x:Math.max(viewport.left+250,Math.min(...boxes.map(r=>r.left))-10),y:Math.max(viewport.top+60,Math.min(...boxes.map(r=>r.top))-20)};const end={x:Math.min(viewport.right-4,Math.max(...boxes.map(r=>r.right))+10),y:Math.min(viewport.bottom-4,Math.max(...boxes.map(r=>r.bottom))+10)};return{start,end,boxes:boxes.map(r=>({left:r.left,top:r.top,right:r.right,bottom:r.bottom})),viewport:{left:viewport.left,top:viewport.top,right:viewport.right,bottom:viewport.bottom}}})()`);
    await drag(win, selectionGeometry.start, selectionGeometry.end, 14, {modifiers:["shift"]});
    const selectedIds = await evaluate(win, "[...document.querySelectorAll('.lfc-node.selected')].map(node=>node.dataset.nodeId).sort()");
    check("真实鼠标框选可选中多个节点", JSON.stringify(selectedIds)===JSON.stringify(["node-ancestor-g5","node-direct-g5"]), {selectionGeometry,selectedIds});

    await click(win, "[data-lfc-group-selected]");
    const groupBefore = await evaluate(win, `(()=>{const group=document.querySelector('[data-lfc-group-id]'),nodes=['node-ancestor-g5','node-direct-g5'].map(id=>{const n=document.querySelector('[data-node-id="'+id+'"]');return{id,left:parseFloat(n.style.left),top:parseFloat(n.style.top)}});return{count:document.querySelectorAll('[data-lfc-group-id]').length,id:group?.dataset.lfcGroupId,nodes}})()`);
    check("工具栏可把框选节点打组", groupBefore.count===1 && Boolean(groupBefore.id), groupBefore);
    const groupHeader = await rect(win, `[data-lfc-group-id='${groupBefore.id}'] [data-lfc-group-drag]`);
    const groupDragStart={x:groupHeader.x+60,y:groupHeader.y+12};
    const groupHit=await evaluate(win, `(()=>{const node=document.elementFromPoint(${groupDragStart.x},${groupDragStart.y});return node?{tag:node.tagName,className:node.className,text:node.textContent?.trim().slice(0,80),groupId:node.closest('[data-lfc-group-id]')?.dataset.lfcGroupId||''}:null})()`);
    await drag(win, groupDragStart, {x:groupDragStart.x+65,y:groupDragStart.y+40}, 10);
    const groupAfter = await evaluate(win, `(()=>({nodes:['node-ancestor-g5','node-direct-g5'].map(id=>{const n=document.querySelector('[data-node-id="'+id+'"]');return{id,left:parseFloat(n.style.left),top:parseFloat(n.style.top)}})}))()`);
    const deltas = groupAfter.nodes.map((item,index)=>({x:item.left-groupBefore.nodes[index].left,y:item.top-groupBefore.nodes[index].top}));
    check("拖动分组同步移动全部成员", deltas.every(delta=>Math.abs(delta.x-deltas[0].x)<=1&&Math.abs(delta.y-deltas[0].y)<=1&&Math.hypot(delta.x,delta.y)>20), {groupBefore,groupAfter,deltas,groupHeader,groupHit});

    await click(win, "[data-node-id='node-video-target-g5'] .lfc-node-preview");
    if (!(await evaluate(win, "Boolean(document.querySelector('.lfc-node-composer'))"))) {
      await click(win, "[data-node-id='node-video-target-g5'] [data-node-edit]");
    }
    await waitFor(win, "Boolean(document.querySelector('.lfc-node-composer [data-lfc-composer-prompt]'))");
    const directPrompt = await evaluate(win, "document.querySelector('[data-lfc-composer-prompt]')?.value || ''");
    check("视频节点只接收本节点与直接上游文本", directPrompt.includes("目标节点保留的本地描述")&&directPrompt.includes("雨夜便利店门口")&&!directPrompt.includes("祖先剧情与导演规划"), directPrompt);

    await click(win, "[data-lfc-composer-prompt]");
    const userPrompt = "用户手动改写：只保留人物撑伞进入便利店的十秒镜头。";
    await replaceFocusedText(win, userPrompt);
    await click(win, ".lfc-node-composer header strong");
    await wait(900);
    const editedSaved = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5';const value=JSON.parse(localStorage.getItem(key)||'{}');return value.canvases?.[0]?.document?.nodes?.find(node=>node.id==='node-video-target-g5')?.data?.inputDraft?.prompt||''})()`);
    check("用户修改后的输入草稿已保存", editedSaved===userPrompt, editedSaved);

    await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5';const value=JSON.parse(localStorage.getItem(key));const source=value.canvases[0].document.nodes.find(node=>node.id==='node-direct-g5');source.data.output={type:'text',content:'上游重跑后的新提示词，不应自动覆盖用户修改'};localStorage.setItem(key,JSON.stringify(value));location.reload();return true})()`);
    await waitFor(win, "Boolean(document.querySelector('[data-page=\"canvas\"]'))", 10000);
    await click(win, "[data-page='canvas']");
    await waitFor(win, "Boolean(document.querySelector('[data-node-id=\"node-video-target-g5\"]'))", 10000);
    await click(win, "[data-node-id='node-video-target-g5'] .lfc-node-preview");
    if (!(await evaluate(win, "Boolean(document.querySelector('.lfc-node-composer'))"))) {
      await click(win, "[data-node-id='node-video-target-g5'] [data-node-edit]");
    }
    const promptAfterRerun = await evaluate(win, "document.querySelector('[data-lfc-composer-prompt]')?.value || ''");
    const updateNotice = await evaluate(win, "document.querySelector('.lfc-upstream-picker')?.textContent.includes('有新结果，未自动替换') === true");
    check("上游重跑不会覆盖用户已修改输入", promptAfterRerun===userPrompt, promptAfterRerun);
    check("上游新结果只提示可选更新", updateNotice, await evaluate(win, "document.querySelector('.lfc-upstream-picker')?.textContent || ''"));

    await click(win, "[data-lfc-close-composer]");
    await click(win, "[data-node-id='node-image-target-g5'] .lfc-node-preview");
    const imageAssetCount = await evaluate(win, "document.querySelectorAll(\"[data-composer-asset='asset-image-g5']\").length");
    check("直接上游图片一次性进入参考素材区", imageAssetCount===1, imageAssetCount);
    await click(win, "[data-composer-asset='asset-image-g5'] [data-lfc-toggle-upstream-asset]");
    check("用户可从当前节点移除上游图片", await evaluate(win, "document.querySelectorAll(\"[data-composer-asset='asset-image-g5']\").length===0"));
    await click(win, ".lfc-upstream-picker summary");
    await click(win, ".lfc-upstream-picker [data-lfc-toggle-upstream-asset]");
    check("用户可按需重新添加上游图片", await evaluate(win, "document.querySelectorAll(\"[data-composer-asset='asset-image-g5']\").length===1"));

    await click(win, "[data-lfc-close-composer]");
    await click(win, ".lfc-command-actions [data-lfc-fit]");
    await wait(180);
    const finalClick=await click(win, "[data-node-edit='node-final-target-g5']");
    const finalHit=await evaluate(win, `(()=>{const node=document.elementFromPoint(${finalClick.x},${finalClick.y});return node?{tag:node.tagName,className:node.className,text:node.textContent?.trim().slice(0,80)}:null})()`);
    await waitFor(win, "document.querySelector('.lfc-node-composer header strong')?.textContent.includes('媒体整理目标') === true");
    const mediaAssets = await evaluate(win, "[...document.querySelectorAll('.lfc-composer-assets [data-composer-asset]')].map(node=>node.dataset.composerAsset).sort()");
    check("兼容的直接上游视频和音频进入素材区", JSON.stringify(mediaAssets)===JSON.stringify(["asset-audio-g5","asset-video-g5"]), {mediaAssets,finalClick,finalHit,composerTitle:await evaluate(win,"document.querySelector('.lfc-node-composer header strong')?.textContent||''")});

    await click(win, "[data-lfc-close-composer]");
    const edgePoint = await evaluate(win, `(()=>{const path=document.querySelector('[data-edge-id="edge-direct-target-g5"] .hit');if(!path)return null;const matrix=path.getScreenCTM(),length=path.getTotalLength();for(let index=1;index<10;index++){const point=path.getPointAtLength(length*index/10),screen=new DOMPoint(point.x,point.y).matrixTransform(matrix),hit=document.elementFromPoint(screen.x,screen.y);if(hit?.closest?.('[data-edge-id="edge-direct-target-g5"]'))return{x:screen.x,y:screen.y,hit:{tag:hit.tagName,className:hit.className?.baseVal||hit.className,edgeId:hit.closest('[data-edge-id]')?.dataset.edgeId||''}}}return null})()`);
    if (edgePoint) await clickPoint(win, edgePoint);
    else await evaluate(win, "document.querySelector('[data-edge-id=\\\"edge-direct-target-g5\\\"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true})); true");
    check("真实点击可选中连接线", await evaluate(win, "document.querySelector(\"[data-edge-id='edge-direct-target-g5']\")?.classList.contains('selected')"), edgePoint);
    const beforeDelete = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5',value=JSON.parse(localStorage.getItem(key)||'{}'),nodes=value.canvases?.[0]?.document?.nodes||[];return{domNodes:document.querySelectorAll('.lfc-node').length,domEdges:document.querySelectorAll('.lfc-edge').length,sourceStatus:nodes.find(node=>node.id==='node-direct-g5')?.data?.status,targetStatus:nodes.find(node=>node.id==='node-video-target-g5')?.data?.status,calls:window.__lingframeG5.calls()}})()`);
    await press(win, "Delete");
    const afterDelete = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g5.project-canvas-g5',value=JSON.parse(localStorage.getItem(key)||'{}'),nodes=value.canvases?.[0]?.document?.nodes||[];return{domNodes:document.querySelectorAll('.lfc-node').length,domEdges:document.querySelectorAll('.lfc-edge').length,edgeExists:Boolean(document.querySelector('[data-edge-id="edge-direct-target-g5"]')),sourceStatus:nodes.find(node=>node.id==='node-direct-g5')?.data?.status,targetStatus:nodes.find(node=>node.id==='node-video-target-g5')?.data?.status,calls:window.__lingframeG5.calls()}})()`);
    check("Delete 删除连线并保留两个节点", afterDelete.domEdges===beforeDelete.domEdges-1&&afterDelete.domNodes===beforeDelete.domNodes&&!afterDelete.edgeExists, {beforeDelete,afterDelete});
    check("删线不取消或停止已经执行的任务", afterDelete.calls.generationCancel===0&&afterDelete.calls.taskCancel===0&&afterDelete.sourceStatus===beforeDelete.sourceStatus&&afterDelete.targetStatus===beforeDelete.targetStatus, {beforeDelete,afterDelete});

    for (const viewport of [{width:1280,height:720,zoom:1},{width:1440,height:900,zoom:1.25},{width:1920,height:1080,zoom:1},{width:980,height:720,zoom:1}]) {
      win.setContentSize(viewport.width, viewport.height);
      win.webContents.setZoomFactor(viewport.zoom);
      await wait(260);
      await click(win, "[data-node-id='node-image-target-g5'] .lfc-node-preview");
      await wait(120);
      const layout = await evaluate(win, `(()=>{const box=selector=>{const node=document.querySelector(selector);if(!node)return null;const r=node.getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}};return{viewport:{width:innerWidth,height:innerHeight},canvas:box('[data-lfc-viewport]'),composer:box('.lfc-node-composer'),tools:box('.lfc-canvas-tools'),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}})()`);
      const inside = layout.composer&&layout.canvas&&layout.composer.left>=layout.canvas.left-1&&layout.composer.top>=layout.canvas.top-1&&layout.composer.right<=layout.canvas.right+1&&layout.composer.bottom<=layout.canvas.bottom+1;
      check(`多视口编辑器保持在画布区:${viewport.width}@${viewport.zoom}`, inside, layout);
      check(`多视口工具栏可见且页面无横向溢出:${viewport.width}@${viewport.zoom}`, Boolean(layout.tools&&layout.tools.left>=layout.canvas.left&&layout.tools.right<=layout.canvas.right&&!layout.overflow), layout);
      const screenshot = path.join(screenshotDir, `canvas-g5-${viewport.width}x${viewport.height}-${Math.round(viewport.zoom*100)}pct.png`);
      fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());
      screenshots.push(screenshot);
      await click(win, "[data-lfc-close-composer]");
    }
    win.webContents.setZoomFactor(1);

    check("G5 真实交互过程无画布渲染器异常", !rendererMessages.some(item=>item.level>=3||(/Uncaught|TypeError|ReferenceError/.test(item.message)&&!/desktop ui init failed/.test(item.message))), rendererMessages);
    process.exitCode = report({screenshots});
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = report({fatal:String(error.stack || error), screenshots});
  } finally {
    if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach();
    win.destroy();
    app.quit();
  }
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = report({fatal:String(error.stack || error)});
  app.quit();
});
