"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");
const {ModelGatewayBridge} = require("../src/main/model-gateway-bridge.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truthFile = path.join(root, "references", "model-multi-result-recovery-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthFile, "utf8"));
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive: true});

function environment(name, gateway, fetchImpl) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), `lingframe-${name}-`));
  const tasks = new WorkbenchDataBridge({tenantRootProvider: () => temp});
  const project = tasks.createProject({name});
  const orchestrator = new GenerationOrchestrator({tenantIdProvider: () => path.basename(temp), tasks, modelGateway: gateway, agentBridge: {}, dataRootProvider: () => temp, fetchImpl: fetchImpl || (async () => ({ok: true, arrayBuffer: async () => Buffer.from("result")}))});
  const createTask = (input = {}) => tasks.createTask({projectId: project.id, title: input.title || name, prompt: input.prompt || name, creationType: "image", executionChannel: "model-gateway", providerId: "provider-1", modelId: "image-model", state: input.state || "queued", ...input});
  return {temp, tasks, project, orchestrator, createTask};
}

function generated(urls, extra = {}) {
  return {ok: true, type: "image", providerId: "provider-1", modelId: "image-model", clientRequestId: "client-1", providerJobId: "job-1", urls, expectedResultCount: urls.length, pending: false, ...extra};
}

async function threeResultsComplete() {
  const gateway = {generate: async () => generated(["https://result.invalid/a.png", "https://result.invalid/b.png", "https://result.invalid/c.png"])};
  const env = environment("multi-three", gateway);const task = env.createTask();await env.orchestrator.runModel(task);const current = env.tasks.bootstrap().tasks.find(item => item.id === task.id);
  assert.equal(current.state, truth.cases.three_results.expectedState);assert.equal(current.resultAssetIds.length, truth.cases.three_results.expectedAssets);assert.equal(current.resultItems.filter(item => item.status === "imported").length, 3);assert.equal(env.tasks.bootstrap().assets.length, 3);env.orchestrator.dispose();return {state: current.state, assets: current.resultAssetIds.length};
}

async function partialResumeOnlyMissing() {
  let online = false;const calls = new Map();const gateway = {generate: async () => generated(["https://result.invalid/a.png", "https://result.invalid/b.png", "https://result.invalid/c.png"])};
  const env = environment("partial-resume", gateway, async url => {const key=String(url);calls.set(key,(calls.get(key)||0)+1);if(key.includes("/b.png")&&!online)throw new TypeError("fetch failed");return {ok:true,arrayBuffer:async()=>Buffer.from(key)};});
  const task=env.createTask();await env.orchestrator.runModel(task);let current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"downloading");assert.equal(current.recoveredResultCount,truth.cases.partial_resume.firstRecovered);assert.equal(env.tasks.bootstrap().assets.length,2);const aCalls=calls.get("https://result.invalid/a.png")||0,cCalls=calls.get("https://result.invalid/c.png")||0;online=true;await env.orchestrator.recoverModelResult(current);current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"completed");assert.equal(current.recoveredResultCount,truth.cases.partial_resume.finalRecovered);assert.equal(env.tasks.bootstrap().assets.length,3);assert.equal(calls.get("https://result.invalid/a.png"),aCalls);assert.equal(calls.get("https://result.invalid/c.png"),cCalls);env.orchestrator.dispose();return {first:2,final:3,assets:3};
}

async function parallelTasksDoNotCross() {
  const gateway={generate:async(_provider,_model,input)=>input.prompt==="task-a"?generated(["https://result.invalid/a1.png","https://result.invalid/a2.png","https://result.invalid/a3.png"],{providerJobId:"job-a"}):generated(["https://result.invalid/b1.png","https://result.invalid/b2.png"],{providerJobId:"job-b"})};
  const env=environment("parallel",gateway);const a=env.createTask({title:"A",prompt:"task-a"}),b=env.createTask({title:"B",prompt:"task-b"});await Promise.all([env.orchestrator.runModel(a),env.orchestrator.runModel(b)]);const tasks=env.tasks.bootstrap().tasks,aa=tasks.find(item=>item.id===a.id),bb=tasks.find(item=>item.id===b.id);assert.equal(aa.resultAssetIds.length,truth.cases.parallel_tasks.taskA);assert.equal(bb.resultAssetIds.length,truth.cases.parallel_tasks.taskB);assert.equal(new Set([...aa.resultAssetIds,...bb.resultAssetIds]).size,5);env.orchestrator.dispose();return {a:aa.resultAssetIds.length,b:bb.resultAssetIds.length};
}

async function finalBindingRetryIsIdempotent() {
  const gateway={generate:async()=>generated(["https://result.invalid/a.png","https://result.invalid/b.png"])};const env=environment("binding-retry",gateway);const original=env.tasks.completeTask.bind(env.tasks);let completeCalls=0;env.tasks.completeTask=(...args)=>{completeCalls+=1;if(completeCalls===1)throw new Error("模拟最终绑定失败");return original(...args);};const task=env.createTask();await env.orchestrator.runModel(task);let checkpoint=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(env.tasks.bootstrap().assets.length,2);const firstItem=checkpoint.resultItems[0],firstName=fs.readdirSync(path.join(env.temp,"downloads")).find(name=>name.includes(`-${firstItem.index+1}-`)),firstDownload=path.join(env.temp,"downloads",firstName),deduped=env.tasks.importAssets({projectId:env.project.id,paths:[firstDownload],source:"model-gateway-generation",dedupeKey:firstItem.key})[0];assert.equal(deduped.id,firstItem.assetId);assert.equal(env.tasks.bootstrap().assets.length,2);await env.orchestrator.recoverModelResult(checkpoint);const current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"completed");assert.equal(env.tasks.bootstrap().assets.length,2);env.orchestrator.dispose();return {completeCalls,assets:2};
}

async function providerConcurrencyIsEnforced() {
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-provider-limit-"));let active=0,maxActive=0;const bridge=new ModelGatewayBridge({tenantRootProvider:()=>temp,requestJson:async()=>{active+=1;maxActive=Math.max(maxActive,active);await new Promise(resolve=>setTimeout(resolve,20));active-=1;return {ok:true,body:{choices:[{message:{content:"ok"}}]}};}});const provider=bridge.createProvider({name:"限流",baseUrl:"https://example.invalid/v1",concurrency:truth.rules.provider_submission_concurrency});bridge.addModel(provider.id,{id:"text-model",capabilities:{type:"text",confirmed:true}});await Promise.all(Array.from({length:5},(_,index)=>bridge.generate(provider.id,"text-model",{prompt:`task-${index}`})));assert.equal(maxActive,truth.rules.provider_submission_concurrency);return {maxActive};
}

async function manualSupplementDoesNotGenerate() {
  let generateCalls=0;const gateway={generate:async()=>{generateCalls+=1;return generated([]);}};const env=environment("manual-supplement",gateway);const task=env.createTask({state:"paused"});env.tasks.reportTask(task.id,{state:"paused",resultType:"image",resultUrls:["https://result.invalid/a.png","https://result.invalid/b.png"],expectedResultCount:3,recoveryState:"result_review_required",evidence:{tenantId:path.basename(env.temp),providerId:"provider-1",modelId:"image-model",submittedAt:new Date().toISOString()}});await env.orchestrator.updateModelResult(task.id,{resultUrls:["https://result.invalid/a.png","https://result.invalid/b.png","https://result.invalid/c.png"],resultType:"image",expectedResultCount:3,replace:true});const current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"completed");assert.equal(current.resultAssetIds.length,3);assert.equal(generateCalls,0);env.orchestrator.dispose();return {state:current.state,generateCalls};
}

async function pauseAndResumeFromCheckpoint() {
  let generateCalls=0,queryCalls=0;const gateway={generate:async()=>{generateCalls+=1;},queryGeneration:async()=>{queryCalls+=1;return {supported:true,completed:true,pending:false,failed:false,notFound:false,status:"completed",urls:["https://result.invalid/resumed.png"],expectedResultCount:1,providerJobId:"job-resume"};}};const env=environment("pause-resume",gateway);const task=env.createTask({state:"generating"});env.tasks.reportTask(task.id,{state:"generating",providerJobId:"job-resume",clientRequestId:"client-resume",resultType:"image",evidence:{tenantId:path.basename(env.temp),providerId:"provider-1",modelId:"image-model",submittedAt:new Date().toISOString()}});env.orchestrator.scheduleModelRecovery(task.id,5000);assert(env.orchestrator.modelRecoveryTimers.has(task.id));await env.orchestrator.pauseModel(task.id);assert(!env.orchestrator.modelRecoveryTimers.has(task.id));await env.orchestrator.resumeModel(task.id);const current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"completed");assert.equal(generateCalls,0);assert.equal(queryCalls,1);env.orchestrator.dispose();return {state:current.state,generateCalls,queryCalls};
}

async function cancelSemantics() {
  const gateway={cancelGeneration:async()=>({supported:false,cancelled:false,error:"未配置取消接口"})};const env=environment("cancel",gateway);const before=env.createTask({state:"queued"});const beforeCancelled=await env.orchestrator.cancel(before.id);assert.equal(beforeCancelled.state,"cancelled");const after=env.createTask({state:"generating"});env.tasks.reportTask(after.id,{state:"generating",providerJobId:"job-cancel",clientRequestId:"client-cancel"});const afterCancelled=await env.orchestrator.cancel(after.id);assert.equal(afterCancelled.state,"cancelled");assert.equal(afterCancelled.recoveryState,"local_tracking_cancelled");assert(afterCancelled.statusText.includes("厂商可能仍会继续执行并计费"));env.orchestrator.dispose();return {before:beforeCancelled.state,after:afterCancelled.recoveryState};
}

async function duplicateUrlsAreDeduplicated() {
  const gateway={generate:async()=>generated(["https://result.invalid/a.png","https://result.invalid/a.png","https://result.invalid/b.png"],{expectedResultCount:2})};const env=environment("dedupe",gateway);const task=env.createTask();await env.orchestrator.runModel(task);const current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"completed");assert.equal(current.resultItems.length,2);assert.equal(env.tasks.bootstrap().assets.length,2);env.orchestrator.dispose();return {items:2,assets:2};
}

async function countMismatchRequiresReview() {
  const gateway={generate:async()=>generated(["https://result.invalid/a.png","https://result.invalid/b.png"],{expectedResultCount:truth.cases.count_mismatch.expected})};const env=environment("count-mismatch",gateway);const task=env.createTask();await env.orchestrator.runModel(task);const current=env.tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,truth.cases.count_mismatch.expectedState);assert.equal(current.recoveryState,truth.rules.manual_review_recovery_state);assert.equal(current.recoveredResultCount,truth.cases.count_mismatch.actual);assert.equal(env.tasks.bootstrap().assets.length,2);env.orchestrator.dispose();return {state:current.state,recovered:current.recoveredResultCount,expected:current.expectedResultCount};
}

async function uiAndIpcContract() {
  const main=fs.readFileSync(path.join(root,"src/main/main.cjs"),"utf8"),preload=fs.readFileSync(path.join(root,"src/preload/preload.cjs"),"utf8"),center=fs.readFileSync(path.join(root,"src/renderer/task-center.js"),"utf8"),dock=fs.readFileSync(path.join(root,"src/renderer/generation-ui.js"),"utf8");for(const marker of ["generation:model-pause","generation:model-resume","generation:model-retry-result","generation:model-update-result"]){assert(main.includes(marker),marker);assert(preload.includes(marker),marker);}for(const marker of ["修改结果","重试回传","取消模型任务","'submission_unknown','paused'"]){assert(center.includes(marker),marker);}for(const marker of ["data-live-model-edit","data-live-model-pause","data-live-model-retry","data-live-model-cancel","confirmModelCancel","厂商仍可能继续执行和计费"]){assert(dock.includes(marker),marker);}return {ipc:4,taskCenter:true,liveDock:true,cancelConfirmation:true,pausedWaitingCount:true};
}

(async()=>{const cases={},failures=[];for(const [name,test] of Object.entries({three_results_complete:threeResultsComplete,partial_resume_only_missing:partialResumeOnlyMissing,parallel_tasks_do_not_cross:parallelTasksDoNotCross,final_binding_retry_idempotent:finalBindingRetryIsIdempotent,provider_concurrency_enforced:providerConcurrencyIsEnforced,manual_supplement_no_generate:manualSupplementDoesNotGenerate,pause_resume_checkpoint:pauseAndResumeFromCheckpoint,cancel_semantics:cancelSemantics,duplicate_urls_deduplicated:duplicateUrlsAreDeduplicated,count_mismatch_requires_review:countMismatchRequiresReview,ui_ipc_contract:uiAndIpcContract})){try{cases[name]={ok:true,detail:await test()};}catch(error){cases[name]={ok:false,error:error.stack||String(error)};failures.push(name);}}const report={test:"model-multi-result-recovery",timestamp:new Date().toISOString(),groundTruth:truthFile,passed:Object.keys(cases).length-failures.length,total:Object.keys(cases).length,failures,cases};fs.writeFileSync(path.join(logDir,"model-multi-result-recovery.json"),JSON.stringify(report,null,2),"utf8");console.log(JSON.stringify(report,null,2));if(failures.length)process.exitCode=1;})();
