"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const RuntimeWebSocket = globalThis.WebSocket || require("undici").WebSocket;

const root = path.resolve(__dirname, "..");
const truthFile = path.join(root, "references", "project-resource-unification-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const app = read("src/renderer/app.js");
const renderer = read("src/renderer/project-materials.js");
const css = read("src/renderer/styles/project-materials.css");
const checks = [];
function check(name, fn) { try { fn(); checks.push({name, ok:true}); } catch (error) { checks.push({name, ok:false, error:String(error.message || error)}); } }
function includesAll(source, values) { for (const value of values) assert(source.includes(value), `缺少 ${value}`); }

check("project resource library is the fixed single entry", () => {
  assert(app.includes("const projectResourceLibraryEnabled=true"));
  assert(!app.includes("PROJECT_RESOURCE_FEATURE_KEY"));
  assert(!app.includes("lingframe.feature.projectResourceLibrary"));
  assert(!app.includes("setEnabled(value)"));
});
check("sidebar exposes only one project resource navigation entry", () => {
  includesAll(app, [`['${truth.unifiedPage}','▧','${truth.unifiedLabel}']`, "const creativeNav="]);
  assert(!app.includes("legacy-resource-route"));
  assert(!app.includes("素材中心兼容入口"));
  assert(!app.includes("项目管理兼容入口"));
});
check("home asset action always opens project resources", () => assert(app.includes("document.querySelector('[data-page=\"resources\"]')?.click()")));
check("unified page owns resource renderer and two modes", () => {
  includesAll(renderer, ["resourceMode:\"assets\"", "renderResourceLibrary", "resourceAssetsPanel", "resourceProjectsPanel", "项目资源库", "项目文件夹"]);
  assert(!renderer.includes("归属与安全"));
  for (const mode of truth.resourceModes) assert(renderer.includes(`data-resource-mode=\"${mode}\"`));
});
check("all legacy project operations remain reachable", () => { for (const action of truth.requiredProjectActions) assert(renderer.includes(`action===\"${action}\"`) || renderer.includes(`data-project-action=\"${action}`), action); });
check("all legacy asset operations remain reachable", () => { for (const action of truth.requiredAssetActions) assert(renderer.includes(`data-asset-action=\"${action}`), action); });
check("unified page retains upload filters preview references and doubao batch controls", () => includesAll(renderer, ["data-asset-upload", "data-asset-drop", "data-asset-search", "data-asset-project", "data-asset-status", "previewAsset", "referenceAsset", "data-select-visible-doubao", "data-copy-doubao-links", "data-copy-doubao-url"]));
check("generation completion refreshes the single resource page", () => includesAll(renderer, ['page()==="resources"', 'pendingResultAssetId:detail.resultAssetId', 'assetProject:detail.projectId||"all"']));
check("legacy routes redirect internally and no restore control remains", () => {
  includesAll(app, ["function normalizePage(page)", "lingframe:resource-mode-request", "page==='materials'||page==='projects'", "return'resources'"]);
  includesAll(renderer, ["lingframe:resource-mode-request", 'targetPage==="projects"', 'state.resourceMode="projects"']);
  assert(!renderer.includes("data-resource-legacy"));
  assert(!renderer.includes("恢复旧双入口"));
  assert(!renderer.includes("lingframeProjectResourceFeature"));
});
check("unified layout has two columns and responsive fallbacks", () => includesAll(css, [".resource-library{display:grid", "grid-template-columns:minmax(220px,240px) minmax(0,1fr)", ".resource-project-rail", ".resource-content", ".resource-material-toolbar{top:-8px;flex-wrap:wrap}", "@media(max-width:1120px)"]));
check("protected modules retain batch A pre-change hashes", () => {
  for (const [file, expected] of Object.entries(truth.protectedHashes)) {
    const actual = crypto.createHash("sha256").update(fs.readFileSync(path.join(root, file))).digest("hex").toUpperCase();
    assert.equal(actual, expected, file);
  }
});

const failed = checks.filter(item => !item.ok);
const result = {test:truth.test, timestamp:new Date().toISOString(), groundTruth:truthFile, total:checks.length, passed:checks.length-failed.length, failed:failed.length, failures:failed, checks};
const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, {recursive:true});
fs.writeFileSync(path.join(logDir, "project-resource-unification.json"), JSON.stringify(result, null, 2));

const runtimePortArg = process.argv.find(value => value.startsWith("--runtime="));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = url => new Promise((resolve, reject) => http.get(url, response => { const chunks=[]; response.on("data", chunk => chunks.push(chunk)); response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (error) { reject(error); } }); }).on("error", reject));
async function connectRuntime(port) {
  const targets = await getJson(`http://127.0.0.1:${port}/json/list`);
  const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
  assert(target, `端口 ${port} 未找到灵帧AI主窗口`);
  const socket = new RuntimeWebSocket(target.webSocketDebuggerUrl); const pending=new Map(); let nextId=0;
  socket.addEventListener("message", event => { const message=JSON.parse(String(event.data)); if(!message.id||!pending.has(message.id))return; const item=pending.get(message.id);pending.delete(message.id);clearTimeout(item.timer);message.error?item.reject(new Error(message.error.message)):item.resolve(message.result||{}); });
  await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
  return {socket,target, send(method, params={}) { const id=++nextId; return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`${method} 超时`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params}));}); }};
}
async function runtimeCheck(port) {
  const cdp=await connectRuntime(port);
  await cdp.send("Page.enable");
  await cdp.send("Emulation.setDeviceMetricsOverride",{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  const evaluate=async expression=>{const response=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text||"运行时求值失败");return response.result?.value;};
  await evaluate(`location.reload();true`);await wait(1600);
  const fixtureAsset=path.join(root,"references","generated-canvas-reference.png");
  const assetMode=await evaluate(`(async()=>{document.querySelector('[data-page="resources"]')?.click();await new Promise(resolve=>setTimeout(resolve,650));let boot=await window.lingframe.workbench.bootstrap(),projectDialogOpened=false,fixtureProjectAttempted=false,fixtureAssetImported=false;if(!(boot.projects||[]).length){document.querySelector('[data-project-create]')?.click();await new Promise(resolve=>setTimeout(resolve,80));const input=document.querySelector('[data-project-name]');projectDialogOpened=Boolean(input);if(input){input.value='批次A隔离预览项目';document.querySelector('[data-project-description]').value='仅用于项目资源库隔离预览与真实点击测试';document.querySelector('[data-project-save]')?.click();await new Promise(resolve=>setTimeout(resolve,650));fixtureProjectAttempted=true;boot=await window.lingframe.workbench.bootstrap();}}if(!(boot.assets||[]).length&&boot.currentProjectId){await window.lingframe.assets.import({projectId:boot.currentProjectId,paths:[${JSON.stringify(fixtureAsset)}]});fixtureAssetImported=true;document.querySelector('[data-page="resources"]')?.click();await new Promise(resolve=>setTimeout(resolve,650));boot=await window.lingframe.workbench.bootstrap();}const projectButton=document.querySelector('[data-resource-project]:not([data-resource-project="all"])');projectButton?.click();await new Promise(resolve=>setTimeout(resolve,160));return{active:document.querySelector('.nav.active')?.dataset.page||'',title:document.querySelector('.page-head h1')?.textContent.trim()||'',navLabels:[...document.querySelectorAll('.sidebar .nav:not([hidden])')].map(node=>node.textContent.trim()),hiddenLegacyRoutes:document.querySelectorAll('.legacy-resource-route[hidden]').length,hasLibrary:Boolean(document.querySelector('.resource-library')),hasProjectRail:Boolean(document.querySelector('.resource-project-rail')),hasContent:Boolean(document.querySelector('.resource-content')),hasSafety:Boolean(document.querySelector('.resource-safety')),projectItems:document.querySelectorAll('.resource-project-item').length,assetCards:document.querySelectorAll('.resource-asset-grid .asset-card').length,bootProjects:(boot.projects||[]).length,bootAssets:(boot.assets||[]).length,locked:boot.locked===true,projectDialogOpened,fixtureProjectAttempted,fixtureAssetImported,filterProject:document.querySelector('[data-asset-project]')?.value||'',controls:{upload:Boolean(document.querySelector('[data-asset-upload]')),search:Boolean(document.querySelector('[data-asset-search]')),status:Boolean(document.querySelector('[data-asset-status]')),preview:document.querySelectorAll('[data-asset-action="preview"]').length,reference:document.querySelectorAll('[data-asset-action="reference"]').length,doubaoSelect:document.querySelectorAll('[data-select-doubao-asset]').length,doubaoCopy:document.querySelectorAll('[data-copy-doubao-url]').length,batchCopy:Boolean(document.querySelector('[data-copy-doubao-links]'))}}})()`);
  assetMode.visibleLegacyRoutes=await evaluate(`[...document.querySelectorAll('.legacy-resource-route')].filter(node=>getComputedStyle(node).display!=='none').length`);
  const projectPopulationValid=assetMode.bootProjects>0?assetMode.projectItems>0:(assetMode.locked&&assetMode.projectItems===0&&assetMode.projectDialogOpened&&assetMode.fixtureProjectAttempted);if(assetMode.active!==truth.unifiedPage||assetMode.title!==truth.unifiedLabel||!assetMode.hasLibrary||!assetMode.hasProjectRail||!assetMode.hasContent||assetMode.hasSafety||!projectPopulationValid||!assetMode.controls.upload||!assetMode.controls.search||!assetMode.controls.status||assetMode.hiddenLegacyRoutes!==0||assetMode.visibleLegacyRoutes!==0||assetMode.navLabels.includes("素材中心")||assetMode.navLabels.includes("项目管理")){cdp.socket.close();throw new Error(`资源库素材视图运行态不符合预期：${JSON.stringify(assetMode)}`);}
  assetMode.interactions=await evaluate(`(async()=>{const preview=document.querySelector('[data-asset-action="preview"]');preview?.click();await new Promise(resolve=>setTimeout(resolve,100));const previewOpened=Boolean(document.querySelector('.preview-modal'));document.querySelector('.preview-modal [data-modal-close]')?.click();const one=document.querySelector('[data-select-doubao-asset]');one?.click();await new Promise(resolve=>setTimeout(resolve,80));const singleSelected=Boolean(document.querySelector('[data-select-doubao-asset].selected'));document.querySelector('[data-select-doubao-asset].selected')?.click();await new Promise(resolve=>setTimeout(resolve,80));const singleCleared=!document.querySelector('[data-select-doubao-asset].selected');const all=document.querySelector('[data-select-visible-doubao]');all?.click();await new Promise(resolve=>setTimeout(resolve,80));const visibleSelected=document.querySelectorAll('[data-select-doubao-asset].selected').length;document.querySelector('[data-select-visible-doubao]')?.click();await new Promise(resolve=>setTimeout(resolve,80));const visibleCleared=document.querySelectorAll('[data-select-doubao-asset].selected').length===0;return{previewOpened,singleSelected,singleCleared,visibleSelected,visibleCleared}})()`);
  if(assetMode.bootAssets>0&&!assetMode.interactions.previewOpened)throw new Error(`素材预览真实点击失败：${JSON.stringify(assetMode.interactions)}`);if(assetMode.controls.doubaoSelect>0&&(!assetMode.interactions.singleSelected||!assetMode.interactions.singleCleared||assetMode.interactions.visibleSelected!==assetMode.controls.doubaoSelect||!assetMode.interactions.visibleCleared))throw new Error(`豆包选择真实点击失败：${JSON.stringify(assetMode.interactions)}`);
  const evidenceDir=path.join(root,"backups","project-resource-unification-20260816","runtime-evidence");fs.mkdirSync(evidenceDir,{recursive:true});
  const assetShot=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(evidenceDir,"batch-a-resource-library-assets.png"),Buffer.from(assetShot.data,"base64"));
  const projectMode=await evaluate(`(async()=>{document.querySelector('[data-resource-mode="projects"]')?.click();await new Promise(resolve=>setTimeout(resolve,180));return{modeButton:Boolean(document.querySelector('[data-resource-mode="projects"].on')),overview:Boolean(document.querySelector('.resource-projects-panel .project-overview')),cards:document.querySelectorAll('.resource-project-grid .project-manage-card').length,empty:Boolean(document.querySelector('.resource-project-grid .pm-empty')),createButtons:document.querySelectorAll('[data-project-create]').length,actions:document.querySelectorAll('.resource-project-grid [data-project-action]').length}})()`);
  assert(projectMode.modeButton&&projectMode.overview&&projectMode.createButtons>0&&(assetMode.bootProjects>0?(projectMode.cards>0&&projectMode.actions>0):projectMode.empty));
  const projectShot=await cdp.send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});fs.writeFileSync(path.join(evidenceDir,"batch-a-resource-library-projects.png"),Buffer.from(projectShot.data,"base64"));
  await evaluate(`document.querySelector('[data-resource-mode="assets"]')?.click();true`);
  cdp.socket.close();
  const runtime={ok:true,port,assetMode,projectMode,screenshots:["batch-a-resource-library-assets.png","batch-a-resource-library-projects.png"],completedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(evidenceDir,"batch-a-runtime-report.json"),JSON.stringify(runtime,null,2));return runtime;
}

async function main() {
  if(failed.length){console.log(JSON.stringify(result,null,2));process.exitCode=1;return;}
  if(runtimePortArg)result.runtime=await runtimeCheck(Number(runtimePortArg.split("=")[1]));
  console.log(JSON.stringify(result,null,2));
}
main().catch(error=>{console.error(error.stack||error);process.exit(1);});
