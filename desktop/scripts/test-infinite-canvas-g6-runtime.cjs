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
fs.mkdirSync(logDir, {recursive:true});

app.setPath("userData", path.join(os.tmpdir(), `lingframe-canvas-g6-${process.pid}`));
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

async function selectCanvas(win, canvasId) {
  return evaluate(win, `(()=>{const select=document.querySelector('[data-lfc-canvas-select]');if(!select)return false;select.value=${JSON.stringify(canvasId)};select.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
}

function report(extra = {}) {
  const failed = checks.filter(item => !item.ok);
  const result = {test:"infinite-canvas-g6-runtime", at:new Date().toISOString(), total:checks.length, passed:checks.length-failed.length, failed:failed.length, checks, rendererMessages, ...extra};
  fs.writeFileSync(path.join(logDir, "infinite-canvas-g6-runtime.json"), JSON.stringify(result, null, 2), "utf8");
  console.log(`INFINITE_CANVAS_G6_RUNTIME ${result.passed}/${result.total}`);
  if (failed.length) console.log(JSON.stringify(failed, null, 2));
  return failed.length;
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show:false,
    width:1500,
    height:920,
    webPreferences:{
      preload:path.join(__dirname, "test-infinite-canvas-g6-runtime-preload.cjs"),
      contextIsolation:true,
      nodeIntegration:false,
      backgroundThrottling:false
    }
  });
  win.webContents.on("console-message", (_, level, message, line, sourceId) => rendererMessages.push({level,message,line,sourceId}));
  win.webContents.on("render-process-gone", (_, detail) => rendererMessages.push({level:3,message:`render-process-gone:${JSON.stringify(detail)}`}));
  try {
    await win.loadFile(path.join(root, "src", "renderer", "index.html"));
    await waitFor(win, "Boolean(window.LingframeCanvasCore && document.querySelector('[data-page=\"canvas\"]'))");
    const seeded = await evaluate(win, `(()=>{
      const core=window.LingframeCanvasCore, now=new Date().toISOString();
      const source=core.makeNode('text',{x:80,y:90},{id:'node-source-a-g6',title:'A 直接上游',instruction:'A 上游本地说明',status:'completed',output:{type:'text',content:'A 直接上游文本'}});
      const target=core.makeNode('image-generation',{x:430,y:90},{id:'node-target-a-g6',title:'A 运行目标',instruction:'A 本地输入',status:'generating',refs:{assetIds:[],assetRoles:{},jobIds:['task-running-g6'],conversationIds:[]},executionEnvelope:{version:1,nodeId:'node-target-a-g6',canvasId:'canvas-a-g6',projectId:'project-canvas-g6',providerId:'provider-g6',modelId:'image-g6'}});
      const edge=core.makeEdge(source.id,target.id,{id:'edge-a-g6',bindingId:'edge-a-g6'});
      target.data.inputDraft={version:1,active:true,prompt:'A 本地输入\\n\\nA 直接上游文本',acceptedBindings:{'edge-a-g6':{fingerprint:'seed',text:'A 直接上游文本'}},createdAt:now,updatedAt:now};
      const group=core.makeGroup([source.id,target.id],[source,target],{id:'group-a-g6',title:'A 持久化分组'});
      const nodeB=core.makeNode('video-prompt',{x:150,y:150},{id:'node-b-g6',title:'B 提示词',instruction:'B 原始输入'});
      const canvasA={id:'canvas-a-g6',title:'G6 画布 A',projectId:'project-canvas-g6',templateId:'blank',status:'draft',createdAt:now,updatedAt:now,versions:[],document:{schemaVersion:core.VERSION,nodes:[source,target],edges:[edge],groups:[group],viewport:{x:40,y:55,zoom:.8},metadata:{templateId:'blank'}}};
      const canvasB={id:'canvas-b-g6',title:'G6 画布 B',projectId:'project-canvas-g6',templateId:'blank',status:'draft',createdAt:now,updatedAt:now,versions:[],document:{schemaVersion:core.VERSION,nodes:[nodeB],edges:[],groups:[],viewport:{x:120,y:95,zoom:1.05},metadata:{templateId:'blank'}}};
      const store={version:2,activeId:'canvas-a-g6',toolMode:'pan',leftCollapsed:false,inspectorCollapsed:false,defaultRoute:{channel:'model-gateway',providerId:'provider-g6',modelId:'image-g6'},canvasUi:{
        'canvas-a-g6':{selectedIds:[source.id,target.id],selectedEdgeIds:[],selectedGroupIds:[group.id],composerNodeId:target.id,composerFocused:false},
        'canvas-b-g6':{selectedIds:[],selectedEdgeIds:[],selectedGroupIds:[],composerNodeId:'',composerFocused:false}
      },canvases:[canvasA,canvasB]};
      localStorage.setItem('lingframe.infiniteCanvas.v2.tenant-canvas-g6.project-canvas-g6',JSON.stringify(store));
      return {canvases:store.canvases.length,nodes:3,groups:1,edges:1};
    })()`);
    check("G6 双画布夹具已隔离写入", seeded.canvases===2 && seeded.nodes===3 && seeded.groups===1 && seeded.edges===1, seeded);

    await evaluate(win, "document.querySelector('[data-page=\"canvas\"]')?.click(); true");
    const ready = await waitFor(win, "document.querySelectorAll('.lfc-node').length===2 && document.querySelector('[data-lfc-mounted=\"1\"]')", 12000);
    check("G6 画布运行时完成装载", ready);
    if (!ready) throw new Error("G6 画布未完成装载");
    await wait(250);

    const restoredA = await evaluate(win, `(()=>({
      toolPan:document.querySelector('.lfc-stage')?.classList.contains('tool-pan')===true,
      selectedNodes:[...document.querySelectorAll('.lfc-node.selected')].map(node=>node.dataset.nodeId).sort(),
      selectedGroups:[...document.querySelectorAll('.lfc-node-group.selected')].map(node=>node.dataset.lfcGroupId),
      composer:document.querySelector('.lfc-node-composer strong')?.textContent||''
    }))()`);
    check("刷新恢复画布工具模式", restoredA.toolPan, restoredA);
    check("刷新恢复当前画布选区和分组", JSON.stringify(restoredA.selectedNodes)===JSON.stringify(['node-source-a-g6','node-target-a-g6']) && restoredA.selectedGroups.includes('group-a-g6'), restoredA);
    check("刷新恢复当前画布节点编辑器", restoredA.composer.includes('A 运行目标'), restoredA);

    await selectCanvas(win, "canvas-b-g6");
    await waitFor(win, "document.querySelector('[data-node-id=\"node-b-g6\"]')");
    const cleanB = await evaluate(win, "({nodes:document.querySelectorAll('.lfc-node').length,selected:document.querySelectorAll('.lfc-node.selected').length,composer:Boolean(document.querySelector('.lfc-node-composer'))})");
    check("切换到 B 不继承 A 的选区和编辑器", cleanB.nodes===1 && cleanB.selected===0 && cleanB.composer===false, cleanB);

    await evaluate(win, `(()=>{document.querySelector('[data-node-id="node-b-g6"]')?.click();const input=document.querySelector('[data-lfc-node-instruction]');if(!input)return false;input.value='B 已编辑输入';input.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await wait(180);
    const bHistory = await evaluate(win, "({undoDisabled:document.querySelector('[data-lfc-undo]')?.disabled,composer:document.querySelector('.lfc-node-composer strong')?.textContent||''})");
    check("B 画布生成独立撤销记录并打开自身编辑器", bHistory.undoDisabled===false && bHistory.composer.includes('B 提示词'), bHistory);

    await selectCanvas(win, "canvas-a-g6");
    await waitFor(win, "document.querySelector('[data-edge-id=\"edge-a-g6\"]')");
    const restoredSessionA = await evaluate(win, "({selected:[...document.querySelectorAll('.lfc-node.selected')].map(n=>n.dataset.nodeId).sort(),composer:document.querySelector('.lfc-node-composer strong')?.textContent||''})");
    check("切回 A 恢复 A 自己的选区和编辑器", restoredSessionA.selected.length===2 && restoredSessionA.composer.includes('A 运行目标'), restoredSessionA);

    await evaluate(win, "document.querySelector('[data-edge-id=\"edge-a-g6\"]')?.dispatchEvent(new MouseEvent('click',{bubbles:true}));document.querySelector('.lfc-canvas-tools [data-lfc-delete-edge]')?.click();true");
    await wait(160);
    const deleted = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g6.project-canvas-g6';const store=JSON.parse(localStorage.getItem(key)||'{}');const canvas=store.canvases?.find(item=>item.id==='canvas-a-g6');const target=canvas?.document?.nodes?.find(node=>node.id==='node-target-a-g6');return{domEdges:document.querySelectorAll('[data-edge-id="edge-a-g6"]').length,memoryPrompt:document.querySelector('[data-lfc-composer-prompt]')?.value||'',storedPrompt:target?.data?.inputDraft?.prompt||''}})()`);
    check("删线立即解除直接上游文本绑定", deleted.domEdges===0 && !deleted.memoryPrompt.includes('A 直接上游文本'), deleted);

    await evaluate(win, "document.querySelector('[data-lfc-undo]')?.click(); true");
    await wait(160);
    const undone = await evaluate(win, "({edges:document.querySelectorAll('[data-edge-id=\"edge-a-g6\"]').length,prompt:document.querySelector('[data-lfc-composer-prompt]')?.value||''})");
    check("撤销删线恢复连线和输入草稿", undone.edges===1 && undone.prompt.includes('A 直接上游文本'), undone);
    await evaluate(win, "document.querySelector('[data-lfc-redo]')?.click(); true");
    await wait(160);
    const redone = await evaluate(win, "({edges:document.querySelectorAll('[data-edge-id=\"edge-a-g6\"]').length,prompt:document.querySelector('[data-lfc-composer-prompt]')?.value||''})");
    check("重做删线再次解除绑定", redone.edges===0 && !redone.prompt.includes('A 直接上游文本'), redone);

    const wheelIsolation = await evaluate(win, `(()=>{const viewport=document.querySelector('[data-lfc-viewport]'),body=document.querySelector('.lfc-composer-body'),before=JSON.parse(localStorage.getItem('lingframe.infiniteCanvas.v2.tenant-canvas-g6.project-canvas-g6')).canvases.find(c=>c.id==='canvas-a-g6').document.viewport.zoom;body?.dispatchEvent(new WheelEvent('wheel',{deltaY:320,bubbles:true,cancelable:true}));const world=document.querySelector('[data-lfc-world]')?.style.transform||'';return{before,world,defaultPrevented:false}})()`);
    check("节点编辑器内部滚动不触发画布缩放", wheelIsolation.world.includes(`scale(${wheelIsolation.before})`), wheelIsolation);

    await selectCanvas(win, "canvas-b-g6");
    await wait(120);
    const bSession = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g6.project-canvas-g6';const store=JSON.parse(localStorage.getItem(key)||'{}');const instruction=store.canvases?.find(item=>item.id==='canvas-b-g6')?.document?.nodes?.find(node=>node.id==='node-b-g6')?.data?.instruction||'';return{undoDisabled:document.querySelector('[data-lfc-undo]')?.disabled,instruction,composer:document.querySelector('.lfc-node-composer strong')?.textContent||''}})()`);
    check("切回 B 保留 B 的撤销栈和编辑内容", bSession.undoDisabled===false && bSession.instruction==='B 已编辑输入' && bSession.composer.includes('B 提示词'), bSession);

    await evaluate(win, "window.__lingframeG6.completeRunningTask(); true");
    await wait(1100);
    const inactiveBackfill = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g6.project-canvas-g6';const store=JSON.parse(localStorage.getItem(key)||'{}');const canvas=store.canvases?.find(item=>item.id==='canvas-a-g6');const node=canvas?.document?.nodes?.find(item=>item.id==='node-target-a-g6');return{activeId:store.activeId,status:node?.data?.status,assetId:node?.data?.output?.assetId,recoveryMode:node?.data?.output?.recoveryMode,calls:window.__lingframeG6.calls()}})()`);
    check("切换到 B 后 A 的完成任务仍回填原节点", inactiveBackfill.activeId==='canvas-b-g6' && inactiveBackfill.status==='completed' && inactiveBackfill.assetId==='asset-result-g6' && inactiveBackfill.recoveryMode==='download-only', inactiveBackfill);
    check("画布切换、删线和结果回填均未调用任务取消", inactiveBackfill.calls.generationCancel===0 && inactiveBackfill.calls.taskCancel===0, inactiveBackfill.calls);

    await win.webContents.reload();
    await waitFor(win, "Boolean(window.LingframeCanvasCore && document.querySelector('[data-page=\"canvas\"]'))", 12000);
    await evaluate(win, "document.querySelector('[data-page=\"canvas\"]')?.click(); true");
    await waitFor(win, "document.querySelector('[data-node-id=\"node-b-g6\"]')", 12000);
    await wait(250);
    const afterReload = await evaluate(win, `(()=>{const key='lingframe.infiniteCanvas.v2.tenant-canvas-g6.project-canvas-g6';const store=JSON.parse(localStorage.getItem(key)||'{}');const canvasA=store.canvases?.find(item=>item.id==='canvas-a-g6');const target=canvasA?.document?.nodes?.find(item=>item.id==='node-target-a-g6');return{active:document.querySelector('[data-lfc-canvas-select]')?.value,toolPan:document.querySelector('.lfc-stage')?.classList.contains('tool-pan')===true,selected:[...document.querySelectorAll('.lfc-node.selected')].map(n=>n.dataset.nodeId),composer:document.querySelector('.lfc-node-composer strong')?.textContent||'',aEdges:canvasA?.document?.edges?.length,aPrompt:target?.data?.inputDraft?.prompt,aResult:target?.data?.output?.assetId}})()`);
    check("重载后恢复最后活动画布、工具和 B 的选区编辑器", afterReload.active==='canvas-b-g6' && afterReload.toolPan && afterReload.selected.includes('node-b-g6') && afterReload.composer.includes('B 提示词'), afterReload);
    check("重载后删线状态、输入草稿和原画布结果保持", afterReload.aEdges===0 && !String(afterReload.aPrompt||'').includes('A 直接上游文本') && afterReload.aResult==='asset-result-g6', afterReload);

    const unhandled = rendererMessages.filter(item=>item.level>=3 && !/favicon|Autofill/i.test(item.message||""));
    check("G6 运行期无未处理渲染错误", unhandled.length===0, unhandled);
    process.exitCode = report();
  } catch (error) {
    check("G6 运行测试未异常中断", false, {message:error.message,stack:error.stack});
    process.exitCode = report({fatal:{message:error.message,stack:error.stack}});
  } finally {
    await win.close();
    app.quit();
  }
});
