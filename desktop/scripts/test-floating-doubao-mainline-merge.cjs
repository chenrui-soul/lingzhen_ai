"use strict";
const assert=require("assert");
const crypto=require("crypto");
const fs=require("fs");
const path=require("path");
const {spawnSync}=require("child_process");
const root=path.resolve(__dirname,"..");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references/floating-doubao-mainline-merge-ground-truth.json"),"utf8"));
const read=relative=>fs.readFileSync(path.join(root,relative),"utf8");
const hash=relative=>crypto.createHash("sha256").update(fs.readFileSync(path.join(root,relative))).digest("hex").toUpperCase();
const files={
  canvas:read("src/renderer/infinite-canvas.js"),core:read("src/renderer/canvas-flow-core.js"),canvasCss:read("src/renderer/styles/canvas-media-v2.css"),
  manager:read("src/main/embedded-browser-manager.cjs"),controller:read("src/main/browser-controller.cjs"),orchestrator:read("src/main/generation-orchestrator.cjs"),
  tasks:read("src/main/workbench-data-bridge.cjs"),main:read("src/main/main.cjs"),preload:read("src/preload/preload.cjs"),
  dock:read("src/renderer/generation-ui.js"),home:read("src/renderer/app-fixes.js")
};
const checks=[];const check=(name,fn)=>{try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack||String(error)});}};
check("canvas core hash protected",()=>assert.equal(hash("src/renderer/canvas-flow-core.js"),truth.protectedCanvas.canvasFlowCoreSha256));
check("canvas media v2 hash protected",()=>assert.equal(hash("src/renderer/styles/canvas-media-v2.css"),truth.protectedCanvas.canvasMediaV2Sha256));
check("latest canvas attached editor preserved",()=>{for(const marker of ["composerNodeId","composerFocused","rememberNodeOutput","nodeResults(node)","expandResultAsNode","core.migrateDocument"])assert(files.canvas.includes(marker),marker);});
check("canvas doubao route merged selectively",()=>{for(const marker of ["accountSelectionMode","accountCandidates","data-lfc-route-doubao-model","data-lfc-route-ratio","data-lfc-route-duration","awaiting_quota"])assert(files.canvas.includes(marker),marker);});
check("per-account floating browser",()=>{assert(files.manager.includes("new BrowserWindow")||files.manager.includes("browserWindowFactory"));assert(files.manager.includes("activeTaskIds"));assert(files.manager.includes("showInactive"));assert(!files.manager.includes("WebContentsView"));});
check("running window close protection",()=>{assert(files.manager.includes("event.preventDefault()"));assert(files.manager.includes("任务仍在执行，窗口已隐藏到任务坞"));});
check("task trigger hook",()=>{assert(files.orchestrator.includes("beginBrowserTask"));assert(files.orchestrator.includes("beginTask?."));assert(files.orchestrator.includes("syncBrowserTask"));});
check("same account queue and multi-account parallel",()=>{assert(files.orchestrator.includes("accountQueues"));assert(files.orchestrator.includes("accountKey(task)"));assert(files.orchestrator.includes("同一账号任务将串行执行"));});
check("model gateway bypasses doubao lock",()=>assert(files.orchestrator.indexOf('task.executionChannel === "model-gateway"')<files.orchestrator.indexOf("runDoubaoWithFailover(taskId)")));
check("quota failover and midnight reset",()=>{for(const marker of ["markDoubaoQuotaExhausted","nextDoubaoQuotaReset","scheduleQuotaResume","awaiting_quota","Asia/Shanghai"])assert((files.orchestrator+files.tasks).includes(marker),marker);});
check("submission evidence protects against duplicate generation",()=>{for(const marker of ["submission_unknown","notSentVerified","safeToRetry","videoGenerationRequest"])assert((files.controller+files.orchestrator+files.tasks).includes(marker),marker);});
check("result file url asset task one-to-one",()=>{for(const marker of ["resultAssetId","resultVid","resultUrls","结果素材已归属其他任务","结果 VID 已归属其他任务"])assert((files.orchestrator+files.tasks).includes(marker),marker);});
check("global task dock has no embedded browser host",()=>{assert(files.dock.includes("实时任务坞"));assert(files.dock.includes("document.body.appendChild(shell)"));assert(!files.dock.includes("generation-live-host"));assert(files.dock.includes("activateAccount"));});
check("home and task modal retain automatic account scheduling",()=>{for(const marker of ["__auto__","accountCandidates","doubaoModel","你可以继续操作其他模块"])assert((files.home+files.dock+read("src/renderer/generation-fixes.js")).includes(marker),marker);});
check("floating IPC routes exposed",()=>{for(const marker of ["doubao:hide-account","doubao:activate-account","generation:live-status"])assert((files.main+files.preload).includes(marker),marker);});
for(const relative of ["src/main/embedded-browser-manager.cjs","src/main/browser-controller.cjs","src/main/generation-orchestrator.cjs","src/main/workbench-data-bridge.cjs","src/main/model-gateway-bridge.cjs","src/main/main.cjs","src/preload/preload.cjs","src/renderer/app.js","src/renderer/app-fixes.js","src/renderer/desktop-ui.js","src/renderer/generation-ui.js","src/renderer/generation-fixes.js","src/renderer/infinite-canvas.js"]){check(`syntax ${relative}`,()=>{const result=spawnSync(process.execPath,["--check",path.join(root,relative)],{encoding:"utf8"});assert.equal(result.status,0,result.stderr);});}
const failed=checks.filter(item=>!item.ok);const report={test:"floating-doubao-mainline-merge",timestamp:new Date().toISOString(),baseline:truth.baseline,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};fs.mkdirSync(path.join(root,"scripts/log"),{recursive:true});fs.writeFileSync(path.join(root,"scripts/log/floating-doubao-mainline-merge.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({test:report.test,total:report.total,passed:report.passed,failed:report.failed,failures:failed},null,2));if(failed.length)process.exitCode=1;
