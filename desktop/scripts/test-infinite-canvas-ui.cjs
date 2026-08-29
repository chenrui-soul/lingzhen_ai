"use strict";
const {chromium} = require("playwright");
const fs = require("fs");
const http = require("http");
const path = require("path");
const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "infinite-canvas-ux-ground-truth.json"), "utf8"));
const attachedTruth = JSON.parse(fs.readFileSync(path.join(root, "references", "infinite-canvas-attached-editor-results-ground-truth.json"), "utf8"));
const logDirectory = path.join(root, "scripts", "log");
const shots = path.join(logDirectory, "screenshots", "infinite-canvas");
fs.mkdirSync(shots, {recursive:true});
const browserExecutable = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  path.join(process.env.LOCALAPPDATA || "", "Google/Chrome/Application/chrome.exe"),
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"
].filter(Boolean).find(candidate => fs.existsSync(candidate));
const cdpUrl = String(process.env.PLAYWRIGHT_CDP_URL || "").trim();

const mockScript = () => {
  const resetToken=new URLSearchParams(location.search).get("lfcReset");
  if(resetToken&&sessionStorage.getItem("lingframe.lfcReset")!==resetToken){
    for(const key of Object.keys(localStorage)){
      if(key.startsWith("lingframe.infiniteCanvas.v2.tenant-canvas-test."))localStorage.removeItem(key);
    }
    sessionStorage.setItem("lingframe.lfcReset",resetToken);
  }
  const project = {id:"project-canvas-test",name:"短剧测试项目",description:"",archivedAt:null,deletedAt:null};
  const assets = [
    {id:"asset-text",projectId:project.id,type:"text",name:"故事设定.txt",contentUrl:"data:text/plain;charset=utf-8,%E4%B8%80%E4%B8%AA%E5%85%B3%E4%BA%8E%E9%A3%9E%E8%A1%8C%E6%B0%94%E7%90%83%E7%9A%84%E6%95%85%E4%BA%8B",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    {id:"asset-image",projectId:project.id,type:"image",name:"角色参考图.png",contentUrl:"data:image/svg+xml;charset=utf-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='120'%3E%3Crect width='180' height='120' fill='%23142b4a'/%3E%3Ccircle cx='90' cy='60' r='34' fill='%2335d7ff'/%3E%3C/svg%3E",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    {id:"asset-video",projectId:project.id,type:"video",name:"动作参考.mp4",contentUrl:"data:video/mp4;base64,AAAA",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()},
    {id:"asset-audio",projectId:project.id,type:"audio",name:"旁白参考.mp3",contentUrl:"data:audio/mpeg;base64,AAAA",createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()}
  ];
  const state = {currentProjectId:project.id,projects:[project],assets,textConversations:[],tasks:[]};
  const listeners = {liveStatus:[],liveView:[],doubao:[]};
  let sequence = 0;
  const copy = value => JSON.parse(JSON.stringify(value));
  const ok = async value => copy(value);
  window.lingframe = {
    window:{minimize:()=>ok(true),toggleMaximize:()=>ok(false),close:()=>ok(true),isMaximized:()=>ok(false)},
    app:{diagnostics:()=>ok({version:"test"}),openExternal:()=>ok(true)},
    identity:{status:()=>ok({tenantId:"tenant-canvas-test",usable:true,deviceSuffix:"TEST"})},
    license:{status:()=>ok({usable:true}),activate:()=>ok({usable:true}),refresh:()=>ok({usable:true}),clear:()=>ok(true)},
    agent:{status:()=>ok({online:true,configured:true}),configure:()=>ok(true),openAccount:()=>ok(true),detectAccount:()=>ok({loggedIn:true})},
    workbench:{bootstrap:()=>ok(state)},
    models:{bootstrap:()=>ok([{id:"provider-test",name:"测试模型厂商",models:[
      {id:"text-model",displayName:"文本模型",enabled:true,parameters:{temperature:.7},capabilities:{type:"text",confirmed:true}},
      {id:"image-model",displayName:"图片模型",enabled:true,parameters:{count:1},capabilities:{type:"image",confirmed:true,modes:["text-to-image","image-to-image"],ratios:["1:1","16:9","9:16"],resolutions:["1024p","2048p"],maxReferenceImages:4}},
      {id:"video-model",displayName:"视频模型",enabled:true,parameters:{count:1},capabilities:{type:"video",confirmed:true,modes:["text-to-video","image-to-video"],ratios:["16:9","9:16"],resolutions:["720p","1080p"],durations:["5s","10s"],maxReferenceImages:2}},
      {id:"audio-model",displayName:"音频模型",enabled:true,parameters:{count:1},capabilities:{type:"audio",confirmed:true,durations:["15s","30s"]}}
    ]}])},
    projects:{create:()=>ok(project),update:()=>ok(project),setCurrent:()=>ok(project),delete:()=>ok(true),restore:()=>ok(project)},
    assets:{list:()=>ok(assets),pickImport:()=>ok([]),import:()=>ok([]),readText:id=>ok({id,name:"故事设定.txt",content:id==="asset-text"?"一个关于飞行气球的故事":""}),update:()=>ok({}),delete:()=>ok(true),restore:()=>ok({}),open:()=>ok(true),showInFolder:()=>ok(true)},
    text:{create:async input=>{const item={id:`conversation-${++sequence}`,projectId:input.projectId,title:input.title,type:input.type,content:"",versions:[]};state.textConversations.unshift(item);return copy(item);},update:()=>ok({}),delete:()=>ok(true),restore:()=>ok({}),restoreVersion:()=>ok({}),deleteVersion:()=>ok({})},
    tasks:{create:()=>ok({}),report:()=>ok({}),complete:()=>ok({}),updateResultUrl:()=>ok({}),cancel:()=>ok({}),retry:()=>ok({}),archive:()=>ok({}),delete:()=>ok({}),restore:()=>ok({})},
    generation:{
      create:async input=>{const task={id:`task-${++sequence}`,projectId:input.projectId,title:input.title,prompt:input.prompt,creationType:input.creationType,creationSource:input.creationSource,executionChannel:input.executionChannel,providerId:input.providerId||"",modelId:input.modelId||"",accountId:input.accountId||"",accountName:input.accountName||"",conversationId:input.conversationId||"",assetIds:input.assetIds||[],modelParameters:input.modelParameters||{},state:"queued",statusText:"已创建",progress:0,steps:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};state.tasks.unshift(task);return copy(task);},
      run:()=>ok({}),resume:()=>ok({}),monitor:()=>ok({}),cancel:()=>ok({}),onLiveView:handler=>listeners.liveView.push(handler),onLiveStatus:handler=>listeners.liveStatus.push(handler)
    },
    doubao:{open:()=>ok({}),detect:()=>ok({loggedIn:true}),close:()=>ok({}),popout:()=>ok({}),activateAccount:()=>ok({}),setBounds:()=>ok({}),setPageActive:()=>ok({}),status:()=>ok({}),onStatus:handler=>listeners.doubao.push(handler)}
  };
};

(async () => {
  const server = http.createServer((request,response) => {
    const pathname = decodeURIComponent(new URL(request.url,"http://127.0.0.1").pathname);
    const relative = pathname === "/" ? "src/renderer/index.html" : pathname.replace(/^\/+/,"");
    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) { response.writeHead(403); response.end("Forbidden"); return; }
    fs.readFile(target,(error,data)=>{
      if(error){response.writeHead(404);response.end("Not found");return;}
      const type = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png"}[path.extname(target).toLowerCase()] || "application/octet-stream";
      response.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});response.end(data);
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/`;
  const launchOptions = {headless:true,args:["--allow-file-access-from-files"]};
  if (browserExecutable) launchOptions.executablePath = browserExecutable;
  const browser = cdpUrl ? await chromium.connectOverCDP(cdpUrl) : await chromium.launch(launchOptions);
  const cdpContext = cdpUrl ? browser.contexts()[0] : null;
  const cdpPage = cdpContext ? cdpContext.pages()[0] : null;
  const checks = [];
  const layouts = [];
  const check = (name, ok, detail="") => checks.push({name,ok:Boolean(ok),detail:ok?"":detail});
  for (const viewport of truth.viewports) {
    const page = cdpPage || await browser.newPage({viewport});
    if (cdpContext) await page.setViewportSize(viewport);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(mockScript);
    await page.goto(`${baseUrl}references/infinite-canvas-ui-harness.html?lfcReset=${viewport.width}x${viewport.height}`,{waitUntil:"domcontentloaded",timeout:10000});
    await page.waitForSelector(".shell");
    await page.click("[data-page='canvas']");
    await page.waitForSelector("[data-lfc-mounted='1'] .lfc-node", {timeout:10000});
    await page.waitForTimeout(250);
    const nodeCount = await page.locator(".lfc-node").count();
    const edgeCount = await page.locator(".lfc-edge").count();
    check(`模板节点:${viewport.width}`, nodeCount === 12, `节点数 ${nodeCount}`);
    check(`模板连线:${viewport.width}`, edgeCount === 14, `连线数 ${edgeCount}`);
    check(`无页面异常:${viewport.width}`, errors.length === 0, errors.join(" | "));
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`无横向溢出:${viewport.width}`, !overflow, "页面存在横向溢出");
    check(`运行入口可见:${viewport.width}`, await page.locator("[data-lfc-run-all]").isVisible(), "运行全部按钮不可见");
    for (const kind of ["text","image-input","video-input","audio-input"]) {
      check(`输入节点入口:${kind}:${viewport.width}`, await page.locator(`[data-library-kind='${kind}']`).count() === 1, `缺少 ${kind}`);
    }
    const visibleMetrics = await page.locator(".lfc-node").evaluateAll((nodes) => {const viewport=document.querySelector("[data-lfc-viewport]").getBoundingClientRect(),visible=nodes.filter(node=>{const rect=node.getBoundingClientRect();return rect.right>viewport.left&&rect.left<viewport.right&&rect.bottom>viewport.top&&rect.top<viewport.bottom;});return{count:visible.length,minWidth:Math.min(...visible.map(node=>node.getBoundingClientRect().width))};});
    check(`初始流程可见:${viewport.width}`, visibleMetrics.count >= 6, `可视节点仅 ${visibleMetrics.count}`);
    check(`初始节点可读:${viewport.width}`, visibleMetrics.minWidth >= 55, `最小节点宽度 ${visibleMetrics.minWidth}`);
    layouts.push(await page.evaluate(() => {const viewport=document.querySelector("[data-lfc-viewport]").getBoundingClientRect(),nodes=[...document.querySelectorAll(".lfc-node")].map(node=>{const rect=node.getBoundingClientRect();return{id:node.dataset.nodeId,left:Math.round(rect.left),top:Math.round(rect.top),right:Math.round(rect.right),bottom:Math.round(rect.bottom)};});return{viewport:{left:Math.round(viewport.left),top:Math.round(viewport.top),right:Math.round(viewport.right),bottom:Math.round(viewport.bottom)},world:document.querySelector("[data-lfc-world]").style.transform,nodes};}));
    await page.locator(".lfc-node").first().click();
    await page.waitForSelector(".lfc-node-composer");
    await page.waitForTimeout(100);
    const composerBounds = await page.locator(".lfc-node-composer").boundingBox();
    const selectedNodeBounds = await page.locator(".lfc-node").first().boundingBox();
    const canvasViewportBounds = await page.locator("[data-lfc-viewport]").boundingBox();
    check(`浮动编辑器不溢出:${viewport.width}`, Boolean(composerBounds&&composerBounds.x>=0&&composerBounds.y>=0&&composerBounds.x+composerBounds.width<=viewport.width&&composerBounds.y+composerBounds.height<=viewport.height), JSON.stringify(composerBounds));
    const rectGap = (a,b) => Math.hypot(Math.max(a.x-b.x-b.width,b.x-a.x-a.width,0),Math.max(a.y-b.y-b.height,b.y-a.y-a.height,0));
    const editorInsideCanvas = composerBounds&&canvasViewportBounds&&composerBounds.x>=canvasViewportBounds.x-attachedTruth.attachedEditor.viewportPaddingPx&&composerBounds.y>=canvasViewportBounds.y-attachedTruth.attachedEditor.viewportPaddingPx&&composerBounds.x+composerBounds.width<=canvasViewportBounds.x+canvasViewportBounds.width+attachedTruth.attachedEditor.viewportPaddingPx&&composerBounds.y+composerBounds.height<=canvasViewportBounds.y+canvasViewportBounds.height+attachedTruth.attachedEditor.viewportPaddingPx;
    check(`编辑器限定在画布区:${viewport.width}`, editorInsideCanvas, JSON.stringify({composerBounds,canvasViewportBounds}));
    check(`编辑器贴合当前节点:${viewport.width}`, Boolean(composerBounds&&selectedNodeBounds&&rectGap(composerBounds,selectedNodeBounds)<=attachedTruth.attachedEditor.maxGapPx), JSON.stringify({composerBounds,selectedNodeBounds,gap:composerBounds&&selectedNodeBounds?rectGap(composerBounds,selectedNodeBounds):null}));
    const stableBefore = await page.locator(".lfc-node-composer").boundingBox();
    for(let repeat=0;repeat<3;repeat++)await page.locator(".lfc-node").first().evaluate(element=>element.click());
    const stableAfter = await page.locator(".lfc-node-composer").boundingBox();
    const stableDelta = stableBefore&&stableAfter?Math.hypot(stableAfter.x-stableBefore.x,stableAfter.y-stableBefore.y):Infinity;
    check(`重复点击编辑器不跳动:${viewport.width}`, stableDelta<=attachedTruth.attachedEditor.stableClickMaxDeltaPx, JSON.stringify({stableBefore,stableAfter,stableDelta}));
    const beforeFollow = await page.evaluate(() => {const node=document.querySelector(".lfc-node.selected")?.getBoundingClientRect(),composer=document.querySelector(".lfc-node-composer")?.getBoundingClientRect();return node&&composer?{node:{x:node.x,y:node.y},composer:{x:composer.x,y:composer.y}}:null;});
    if (canvasViewportBounds) {
      await page.locator("[data-lfc-viewport]").dispatchEvent("wheel",{deltaY:-160,clientX:canvasViewportBounds.x+canvasViewportBounds.width-40,clientY:canvasViewportBounds.y+100});
      await page.waitForTimeout(120);
    }
    const afterFollow = await page.evaluate(() => {const node=document.querySelector(".lfc-node.selected")?.getBoundingClientRect(),composer=document.querySelector(".lfc-node-composer")?.getBoundingClientRect();return node&&composer?{node:{x:node.x,y:node.y},composer:{x:composer.x,y:composer.y},gap:Math.hypot(Math.max(composer.x-node.x-node.width,node.x-composer.x-composer.width,0),Math.max(composer.y-node.y-node.height,node.y-composer.y-composer.height,0))}:null;});
    const nodeMoved = beforeFollow&&afterFollow&&Math.hypot(afterFollow.node.x-beforeFollow.node.x,afterFollow.node.y-beforeFollow.node.y)>1;
    const composerMoved = beforeFollow&&afterFollow&&Math.hypot(afterFollow.composer.x-beforeFollow.composer.x,afterFollow.composer.y-beforeFollow.composer.y)>1;
    check(`缩放后编辑器跟随节点:${viewport.width}`, Boolean(nodeMoved&&afterFollow.gap<=attachedTruth.attachedEditor.maxGapPx), JSON.stringify({beforeFollow,afterFollow,composerMoved}));
    await page.click("[data-lfc-focus-composer]");
    await page.waitForSelector(".lfc-node-composer.focused");
    await page.waitForTimeout(240);
    const focusBounds = await page.locator(".lfc-node-composer.focused").boundingBox();
    const focusMinimum = viewport.width>=900?attachedTruth.focusEditor:{minWidthPx:0,minHeightPx:0};
    check(`专注放大编辑可进入:${viewport.width}`, Boolean(focusBounds&&focusBounds.width>=focusMinimum.minWidthPx&&focusBounds.height>=focusMinimum.minHeightPx), JSON.stringify(focusBounds));
    check(`专注编辑无窗口溢出:${viewport.width}`, Boolean(focusBounds&&focusBounds.x>=0&&focusBounds.y>=0&&focusBounds.x+focusBounds.width<=viewport.width&&focusBounds.y+focusBounds.height<=viewport.height), JSON.stringify(focusBounds));
    await page.keyboard.press("Escape");
    await page.waitForTimeout(80);
    check(`Escape退出专注编辑:${viewport.width}`, await page.locator(".lfc-node-composer.focused").count()===0, "专注模式仍未退出");
    await page.click("[data-lfc-close-composer]");
    if (viewport.width === 1920) {
      for (const kind of ["image-input","video-input","audio-input","audio-generation"]) await page.locator(`[data-library-kind='${kind}']`).dblclick();
      check("四类输入节点可加入画布", await page.locator(".lfc-node").filter({has:page.locator(".lfc-node-head")}).count() >= 15, "输入节点未完整加入画布");

      const openNode = async title => {
        const node = page.locator(".lfc-node").filter({hasText:title}).first();
        await node.evaluate(element => element.click());
        await page.waitForSelector(".lfc-node-composer");
      };
      await openNode("故事创意");
      await page.click("[data-lfc-pick-assets]");
      check("文本输入仅显示文本素材", await page.locator("[data-lfc-picker-asset]").count() === 1 && await page.locator("[data-lfc-picker-asset='asset-text']").count() === 1, "文本素材过滤错误");
      await page.click("[data-lfc-picker-asset='asset-text']");
      await page.click("[data-lfc-picker-apply]");
      check("文本素材可加入输入节点", await page.locator("[data-composer-asset='asset-text']").count() === 1, "文本素材未加入");
      check("文本素材内容可写入输入框", (await page.inputValue("[data-lfc-composer-prompt]")).includes("飞行气球"), "文本内容未写入");
      await page.click("[data-lfc-remove-asset='asset-text']");
      check("节点素材可删除", await page.locator("[data-composer-asset='asset-text']").count() === 0, "文本素材未删除");

      await openNode("关键帧生成");
      const imageOptions = await page.locator("[data-lfc-route-model='composer'] option").evaluateAll(options=>options.map(option=>option.value));
      check("图片节点只显示图片模型", JSON.stringify(imageOptions)===JSON.stringify(["provider-test::image-model"]), JSON.stringify(imageOptions));
      check("属性栏显示图片模型类别", await page.inputValue("[data-lfc-model-category]")===attachedTruth.inspectorModelSettings.imageCategory, await page.inputValue("[data-lfc-model-category]"));
      const inspectorImageOptions = await page.locator("[data-lfc-route-model='node'] option").evaluateAll(options=>options.map(option=>option.value));
      check("属性栏只显示对应类别模型", JSON.stringify(inspectorImageOptions)===JSON.stringify(["provider-test::image-model"]), JSON.stringify(inspectorImageOptions));
      const inspectorParameters = await page.locator("[data-lfc-inspector-param]").evaluateAll(inputs=>inputs.map(input=>input.dataset.lfcInspectorParam));
      check("属性栏模型参数齐全", attachedTruth.inspectorModelSettings.requiredParameters.every(name=>inspectorParameters.includes(name)), JSON.stringify(inspectorParameters));
      const parameterBoundsBefore = await page.locator(".lfc-node-composer").boundingBox();
      await page.selectOption("[data-lfc-inspector-param='ratio']", "9:16");
      await page.waitForTimeout(80);
      const parameterBoundsAfter = await page.locator(".lfc-node-composer").boundingBox();
      const parameterDelta = parameterBoundsBefore&&parameterBoundsAfter?Math.hypot(parameterBoundsAfter.x-parameterBoundsBefore.x,parameterBoundsAfter.y-parameterBoundsBefore.y):Infinity;
      check("属性栏修改参数编辑器不跳动", parameterDelta<=attachedTruth.attachedEditor.stableClickMaxDeltaPx, JSON.stringify({parameterBoundsBefore,parameterBoundsAfter,parameterDelta}));
      check("属性栏参数同步到贴合编辑器", await page.inputValue("[data-lfc-param='ratio']")==="9:16", await page.inputValue("[data-lfc-param='ratio']"));
      await page.click("[data-lfc-pick-assets]");
      check("图片节点仅显示图片素材", await page.locator("[data-lfc-picker-asset]").count() === 1 && await page.locator("[data-lfc-picker-asset='asset-image']").count() === 1, "图片素材过滤错误");
      await page.click("[data-lfc-picker-asset='asset-image']");
      await page.click("[data-lfc-picker-apply]");
      check("图片参考素材可加入生成节点", await page.locator("[data-composer-asset='asset-image']").count() === 1, "图片参考素材未加入");
      await page.click("[data-composer-asset='asset-image']");
      await page.waitForSelector(".lfc-asset-viewer");
      check("上传素材可放大预览", await page.locator(".lfc-asset-viewer img").count()===1, "图片预览未打开");
      await page.click("[data-lfc-preview-zoom='in']");
      check("素材预览支持缩放", await page.locator(".lfc-asset-viewer header em").textContent()==="125%", "缩放比例未更新");
      await page.click(".lfc-asset-viewer [data-lfc-close-preview]");
      await page.selectOption("[data-lfc-param='ratio']", "9:16");
      await page.locator(".lfc-node-composer .lfc-composer-parameters details").evaluate(element=>element.open=true);
      await page.fill("[data-lfc-advanced-params]", JSON.stringify({mode:"image-to-image",ratio:"9:16",resolution:"2048p",count:2,seed:2026,guidance:6.5},null,2));
      await page.click("[data-lfc-save-advanced]");
      const savedImageParameters = JSON.parse(await page.inputValue("[data-lfc-advanced-params]"));
      check("生成参数与高级 JSON 可保存", savedImageParameters.ratio==="9:16"&&savedImageParameters.count===2&&savedImageParameters.guidance===6.5, JSON.stringify(savedImageParameters));

      await openNode("视频生成");
      const videoOptions = await page.locator("[data-lfc-route-model='composer'] option").evaluateAll(options=>options.map(option=>option.value));
      check("视频节点只显示视频模型", JSON.stringify(videoOptions)===JSON.stringify(["provider-test::video-model"]), JSON.stringify(videoOptions));
      check("视频参数控件齐全", await page.locator("[data-lfc-param='mode']").count()===1&&await page.locator("[data-lfc-param='duration']").count()===1&&await page.locator("[data-lfc-param='resolution']").count()===1, "视频参数缺失");

      await openNode("音频生成");
      const audioOptions = await page.locator("[data-lfc-route-model='composer'] option").evaluateAll(options=>options.map(option=>option.value));
      check("音频节点只显示音频模型", JSON.stringify(audioOptions)===JSON.stringify(["provider-test::audio-model"]), JSON.stringify(audioOptions));
      await page.click("[data-lfc-close-composer]");

      await page.waitForFunction(() => Object.keys(localStorage).some(item=>item.startsWith("lingframe.infiniteCanvas.v2.tenant-canvas-test")),null,{timeout:3000});
      const resultSeed = await page.evaluate((fixture) => {
        const key=Object.keys(localStorage).find(item=>item.startsWith("lingframe.infiniteCanvas.v2.tenant-canvas-test"));
        const value=JSON.parse(localStorage.getItem(key)||"{}");
        const canvas=(value.canvases||[]).find(item=>item.document?.nodes?.some(node=>node.data?.kind==="image-generation"));
        const node=canvas?.document?.nodes?.find(item=>item.data?.kind==="image-generation");
        if(!node)return null;
        node.data.output={type:fixture.resultType,assetId:fixture.assetId,assetName:fixture.assetName,taskId:"task-result",completedAt:new Date().toISOString()};
        node.data.results=[node.data.output];
        node.data.activeResultId=fixture.assetId;
        node.data.status="completed";
        localStorage.setItem(key,JSON.stringify(value));
        return {key,nodeId:node.id};
      },attachedTruth.resultFixture);
      check("生成结果测试数据已写入", Boolean(resultSeed?.nodeId), JSON.stringify(resultSeed));
      await page.reload({waitUntil:"domcontentloaded"});
      await page.waitForSelector(".shell");
      await page.click("[data-page='canvas']");
      await page.waitForSelector(`[data-node-id='${resultSeed.nodeId}'] .lfc-node-result`);
      check("生成结果保留在原节点", await page.locator(`[data-node-id='${resultSeed.nodeId}'] .lfc-node-result`).count()===1, "原生成节点未显示结果");
      await page.click(`[data-node-id='${resultSeed.nodeId}'] [data-lfc-preview-asset='${attachedTruth.resultFixture.assetId}']`);
      await page.waitForSelector(".lfc-asset-viewer");
      check("原节点结果可直接预览", await page.locator(".lfc-asset-viewer img").count()===1, "结果预览未打开");
      await page.click(".lfc-asset-viewer [data-lfc-close-preview]");
      const beforeExpandNodes=await page.locator(".lfc-node").count();
      const beforeExpandEdges=await page.locator(".lfc-edge").count();
      await page.click(`[data-node-id='${resultSeed.nodeId}'] [data-lfc-expand-result]`);
      await page.waitForTimeout(700);
      check("结果可展开为素材节点", await page.locator(".lfc-node").count()===beforeExpandNodes+1, "节点数未增加");
      check("展开结果自动建立连线", await page.locator(".lfc-edge").count()===beforeExpandEdges+1, "连线数未增加");
      const expandedProof=await page.evaluate(({sourceId,fixture})=>{const key=Object.keys(localStorage).find(item=>item.startsWith("lingframe.infiniteCanvas.v2.tenant-canvas-test"));const value=JSON.parse(localStorage.getItem(key)||"{}");const documentValue=value.canvases?.[0]?.document;const expanded=documentValue?.nodes?.find(node=>node.data?.expandedResult?.sourceNodeId===sourceId&&node.data?.expandedResult?.assetId===fixture.assetId);const downstream=documentValue?.edges?.find(edge=>edge.source===sourceId&&edge.target!==expanded?.id);const downstreamInput=downstream?window.LingframeCanvasCore.resolveNodeExecutionInput(downstream.target,documentValue.nodes,documentValue.edges):null;return{kind:expanded?.data?.kind,assetIds:expanded?.data?.refs?.assetIds||[],downstreamAssetIds:downstreamInput?.upstream?.assetIds||[]};},{sourceId:resultSeed.nodeId,fixture:attachedTruth.resultFixture});
      check("展开节点类型与素材引用正确", expandedProof.kind===attachedTruth.resultFixture.expandedNodeKind&&expandedProof.assetIds.includes(attachedTruth.resultFixture.assetId), JSON.stringify(expandedProof));
      check("生成结果传递到下游节点", expandedProof.downstreamAssetIds.includes(attachedTruth.resultFixture.assetId), JSON.stringify(expandedProof));
      await page.click(`[data-node-id='${resultSeed.nodeId}'] [data-lfc-expand-result]`);
      await page.waitForTimeout(100);
      check("同一结果不会重复展开", await page.locator(".lfc-node").count()===beforeExpandNodes+1&&await page.locator(".lfc-edge").count()===beforeExpandEdges+1, "重复创建了素材节点或连线");

      await page.click("[data-lfc-toggle-left]");
      check("节点库可收起", await page.locator(".lfc-stage.left-collapsed").count() === 1, "未进入收起状态");
      await page.click("[data-lfc-toggle-left]");
      await page.click("[data-lfc-toggle-inspector]");
      check("参数栏可收起", await page.locator(".shell.lfc-inspector-collapsed").count() === 1, "未进入收起状态");
      await page.click("[data-lfc-toggle-inspector]");
      const before = await page.locator(".lfc-node").count();
      const box = await page.locator("[data-lfc-viewport]").boundingBox();
      await page.mouse.click(box.x + box.width - 170, box.y + 115, {button:"right"});
      await page.waitForSelector(".lfc-quick-menu");
      await page.click("[data-menu-kind='prompt']");
      check("右键新增节点", await page.locator(".lfc-node").count() === before + 1, "节点数未增加");
      const beforeConnectNodes = await page.locator(".lfc-node").count();
      const beforeConnectEdges = await page.locator(".lfc-edge").count();
      const sourcePort = await page.locator(".lfc-node").first().locator("[data-node-output]").boundingBox();
      const liveViewport = await page.locator("[data-lfc-viewport]").boundingBox();
      await page.mouse.move(sourcePort.x + sourcePort.width / 2, sourcePort.y + sourcePort.height / 2);
      await page.mouse.down();
      await page.mouse.move(liveViewport.x + liveViewport.width - 180, liveViewport.y + liveViewport.height - 180, {steps:8});
      await page.mouse.up();
      await page.waitForSelector(".lfc-quick-menu");
      await page.click("[data-menu-kind='prompt']");
      check("拉线到空白新增节点", await page.locator(".lfc-node").count() === beforeConnectNodes + 1, "拉线后节点数未增加");
      check("拉线新增连接", await page.locator(".lfc-edge").count() === beforeConnectEdges + 1, "拉线后连线数未增加");
      await page.click("[data-lfc-tab='data']");
      check("上游信息传递可查看", await page.locator(".lfc-upstream-list article").count() >= 1, "新节点未显示上游数据");
      await page.click("[data-lfc-tab='properties']");
      await page.locator(".lfc-node").first().click();
      await page.fill("[data-lfc-node-title]", "故事创意测试节点");
      await page.locator("[data-lfc-node-title]").press("Tab");
      await page.waitForTimeout(800);
      const saved = await page.evaluate(() => Object.keys(localStorage).some(key => key.startsWith("lingframe.infiniteCanvas.v2.tenant-canvas-test") && localStorage.getItem(key).includes("故事创意测试节点")));
      check("自动保存与租户隔离键", saved, "未找到租户项目级画布存储");
      const handlers = await page.evaluate(() => ({run:typeof document.querySelector(".lfc-node [data-node-run]")?.onclick,toggle:typeof document.querySelector("[data-lfc-toggle-runs]")?.onclick}));
      await page.locator(".lfc-node").first().locator("[data-node-run]").click();
      await page.waitForTimeout(200);
      const firstNodeClass = await page.locator(".lfc-node").first().getAttribute("class");
      const storedStatus = await page.evaluate(() => {const key=Object.keys(localStorage).find(item=>item.startsWith("lingframe.infiniteCanvas.v2.tenant-canvas-test"));const value=JSON.parse(localStorage.getItem(key)||"{}");return value.canvases?.[0]?.document?.nodes?.[0]?.data?.status;});
      check("基础节点可执行", firstNodeClass.includes("status-completed"), `DOM=${firstNodeClass} STORE=${storedStatus} HANDLERS=${JSON.stringify(handlers)} ERRORS=${errors.join(" | ")}`);
      await page.click("[data-lfc-toggle-runs]");
      const stageClass = await page.locator(".lfc-stage").getAttribute("class");
      check("运行现场可展开", stageClass.includes("runs-expanded"), `DOM=${stageClass} HANDLERS=${JSON.stringify(handlers)} ERRORS=${errors.join(" | ")}`);
    }
    if (!cdpContext) await page.screenshot({path:path.join(shots,`canvas-${viewport.width}x${viewport.height}.png`),fullPage:true});
    if (!cdpContext) await page.close();
  }
  await browser.close();
  await new Promise(resolve=>server.close(resolve));
  const failed = checks.filter(item => !item.ok);
  const result = {at:new Date().toISOString(),total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks,layouts};
  fs.writeFileSync(path.join(logDirectory,"infinite-canvas-ui.json"),JSON.stringify(result,null,2),"utf8");
  console.log(JSON.stringify(result,null,2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exit(1); });
