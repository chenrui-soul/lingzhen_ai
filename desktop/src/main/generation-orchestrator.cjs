"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const {classifyDoubaoLoginState} = require("./doubao-login-state.cjs");

function generatedAssetMetadata(task = {}, type = "result", channel = "model-gateway") {
  const typeLabel = type === "video" ? "视频" : type === "image" ? "图片" : type === "audio" ? "音频" : "文本";
  const channelLabel = channel === "doubao" ? "豆包生成" : "模型生成";
  const rawTitle = String(task.title || task.prompt || "生成结果").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").replace(/\s+/g, " ").trim();
  const title = (rawTitle || "生成结果").slice(0, 88);
  return {
    name: `${title}-${channelLabel}${typeLabel}`.slice(0, 120),
    tags: [channelLabel, typeLabel, task.creationSource === "home" ? "创作首页" : task.creationSource === "infinite-canvas-v2" ? "无限画布" : "任务生成"],
    notes: `生成任务：${task.id || "未知"}${task.accountName ? `；豆包账号：${task.accountName}` : ""}`
  };
}
const MODEL_RESULT_ITEM_MAX_ATTEMPTS = 3;
const MODEL_QUERY_MAX_ATTEMPTS = 5;
const MODEL_RESULT_DOWNLOAD_CONCURRENCY = 2;
const DOUBAO_BROWSER_TIMEOUTS = {generate:180000,resume:180000,monitor:120000,recover_result:180000,validate_submission_context:30000};
const DOUBAO_RECOVERY_ACCOUNT_STATES = new Set(["queued","preparing","assigned","launching","checking_login","uploading","configuring","submitting","awaiting_confirmation","generating","downloading","verifying","awaiting_quota","submission_unknown"]);

async function runWithConcurrency(items, limit, worker) {
  let cursor=0;const runners=Array.from({length:Math.min(Math.max(1,limit),items.length)},async()=>{while(cursor<items.length){const index=cursor;cursor+=1;await worker(items[index],index);}});await Promise.all(runners);
}

class GenerationOrchestrator {
  constructor({tenantIdProvider, authorizationProvider = null, tasks, modelGateway, agentBridge, accountRegistry = null, dataRootProvider, liveViewProvider = null, liveStatusProvider = null, fetchImpl = null, browserTimeouts = null}) {
    this.tenantIdProvider = tenantIdProvider;
    this.authorizationProvider = authorizationProvider;
    this.boundTenantId = String(tenantIdProvider?.() || "");
    this.tasks = tasks;
    this.modelGateway = modelGateway;
    this.agentBridge = agentBridge;
    this.accountRegistry = accountRegistry;
    this.dataRootProvider = dataRootProvider;
    this.liveViewProvider = liveViewProvider;
    this.liveStatusProvider = liveStatusProvider;
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.browserTimeouts = {...DOUBAO_BROWSER_TIMEOUTS,...(browserTimeouts&&typeof browserTimeouts==="object"?browserTimeouts:{})};
    this.running = new Map();
    this.accountQueues = new Map();
    this.accountOwners = new Map();
    this.accountLeases = new Map();
    this.cancelledTasks = new Set();
    this.monitorTimers = new Map();
    this.monitorAttempts = new Map();
    this.monitorRestoreFailures = new Map();
    this.unknownAuditTimers = new Map();
    this.unknownAuditAttempts = new Map();
    this.quotaTimers = new Map();
    this.accountAvailabilityTimers = new Map();
    this.modelRecoveryTimers = new Map();
    this.modelRecoveryAttempts = new Map();
    this.modelResultRuns = new Map();
    this.doubaoResultRuns = new Map();
    this.modelDownloadActive = 0;
    this.modelDownloadQueue = [];
    this.disposed = false;
  }
  tenantId() { if(this.disposed)throw Object.assign(new Error("任务调度器已停止"),{code:"ORCHESTRATOR_DISPOSED"});const value = this.tenantIdProvider?.(); if (!value) throw new Error("桌面身份尚未验证");if(this.boundTenantId&&String(value)!==this.boundTenantId)throw Object.assign(new Error("租户身份已切换，旧任务执行上下文已停止"),{code:"TENANT_CONTEXT_CHANGED"}); return String(value); }
  authorize(capability) { return this.authorizationProvider?.(capability); }
  assertAuthorizedAccount(account) { if(this.accountRegistry?.assert)return this.accountRegistry.assert(account);if(account&&typeof account==="object")return{id:String(account.id||account.accountId||""),name:String(account.name||account.accountName||account.id||account.accountId||""),platform:"豆包"};return{id:String(account||""),name:String(account||""),platform:"豆包"}; }
  authorizedCandidates(values) { return this.accountRegistry?.filterCandidates ? this.accountRegistry.filterCandidates(values) : values; }
  secureDoubaoCreationInput(input = {}) {
    const requested=[...(String(input.accountId||"").trim()?[{id:input.accountId,name:input.accountName}]:[]),...(Array.isArray(input.accountCandidates)?input.accountCandidates:[])];
    const authorized=this.authorizedCandidates(requested);
    if(!authorized.length)this.assertAuthorizedAccount(input.accountId||requested[0]);
    const unauthorizedIds=new Set(requested.map(item=>String(item?.id||item?.accountId||"").trim()).filter(Boolean));
    for(const account of authorized)unauthorizedIds.delete(account.id);
    if(unauthorizedIds.size)throw Object.assign(new Error("任务候选池包含当前密钥无权使用的豆包账号"),{code:"DOUBAO_ACCOUNT_NOT_AUTHORIZED",accountIds:[...unauthorizedIds]});
    const selected=String(input.accountId||"").trim()?this.assertAuthorizedAccount(input.accountId):authorized[0];
    return {...input,accountId:selected.id,accountName:selected.name,accountCandidates:input.accountSelectionMode==="auto"?authorized:[selected]};
  }
  secureDoubaoRetryAccounts(task = {}) {
    const requested=[...(task.accountId?[{id:task.accountId,name:task.accountName}]:[]),...(Array.isArray(task.accountCandidates)?task.accountCandidates:[])];
    const authorized=this.authorizedCandidates(requested);
    if(!authorized.length)this.assertAuthorizedAccount(task.accountId||requested[0]);
    const selected=authorized.find(item=>item.id===task.accountId)||authorized[0];
    return {accountId:selected.id,accountName:selected.name,accountCandidates:task.accountSelectionMode==="auto"?authorized:[selected]};
  }
  id() { return crypto.randomUUID().replaceAll("-", ""); }
  browserRuntime() { return this.agentBridge?.browser?.embeddedBrowserProvider?.() || null; }
  async detectDoubaoAccount(account) {
    const runtime=this.browserRuntime();
    if(!runtime?.detect)return {state:"unchecked",loginState:"unchecked",loggedIn:false,verificationRequired:false,message:"当前执行环境不支持预检，将在提交前再次核对"};
    try{
      let detected={state:"unknown",loggedIn:false,verificationRequired:false};
      for(let attempt=0;attempt<3;attempt+=1){
        let timer;
        try{const result=await Promise.race([runtime.detect(account),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Object.assign(new Error("豆包登录状态预检超时"),{code:"DOUBAO_LOGIN_CHECK_TIMEOUT"})),20000);})]);detected=classifyDoubaoLoginState(result||{},[]);}
        finally{if(timer)clearTimeout(timer);}
        if(!["loading","unknown"].includes(detected.state)||attempt===2)return detected;
        await new Promise(resolve=>setTimeout(resolve,300*(attempt+1)));
      }
      return detected;
    }catch(error){return {state:"unchecked",loginState:"unchecked",loggedIn:false,verificationRequired:false,message:String(error.message||error),detectionError:String(error.code||"DOUBAO_LOGIN_CHECK_FAILED")};}
  }
  async inspectDoubaoCandidates(task, excluded=new Set()) {
    const candidates=this.doubaoCandidates(task).filter(item=>!excluded.has(item.id)&&!this.tasks.doubaoQuotaBlock?.(item.id,task.doubaoModel)&&!this.accountHumanLocked(item.id));
    return Promise.all(candidates.map(async(item,index)=>({item,index,detection:await this.detectDoubaoAccount(item)})));
  }
  chooseDetectedDoubaoAccount(task, entries=[]) {
    const ranked=entries.map(entry=>({...entry,load:this.accountLoad(entry.item.id)})).sort((a,b)=>a.load-b.load||a.index-b.index);
    const ready=ranked.filter(entry=>entry.detection.state==="logged_in");
    if(ready.length)return {account:ready[0].item,detection:ready[0].detection,waitState:""};
    const unchecked=ranked.filter(entry=>entry.detection.state==="unchecked");
    if(unchecked.length)return {account:unchecked[0].item,detection:unchecked[0].detection,waitState:""};
    const verification=ranked.find(entry=>entry.detection.state==="verification_required");
    const selected=verification||ranked[0];
    if(!selected)return null;
    return {account:selected.item,detection:selected.detection,waitState:verification?"awaiting_verification":"awaiting_login"};
  }
  async waitForDoubaoAuthentication(task, account, detection={}, {preSubmission=true}={}) {
    const verification=detection.state==="verification_required"||detection.verificationRequired===true;
    const state=verification?"awaiting_verification":"awaiting_login";
    const statusText=verification?`豆包账号 ${account.name} 需要人工验证，请完成后点击继续`:`豆包账号 ${account.name} 尚未登录，请登录后点击继续`;
    const checkpointAt=new Date().toISOString();
    const conversationId=String(detection.conversationId||task.conversationId||task.evidence?.conversationId||"");
    const evidence=verification&&!preSubmission?{...(task.evidence||{}),...(detection.submittedEvidence||{}),tenantId:this.tenantId(),accountId:account.id,conversationId,submittedAt:task.evidence?.submittedAt||checkpointAt,verificationRequired:true}:task.evidence;
    return this.report(task.id,{state,stage:state,progressMode:"paused",progress:preSubmission?10:25,statusText,accountId:account.id,accountName:account.name,conversationId,submittedVerified:preSubmission?task.submittedVerified===true:(task.submittedVerified===true||Boolean(conversationId)),evidence,accountAction:"hold",safeToRetry:false,notSentVerified:preSubmission,recoveryState:preSubmission?(verification?"pre_submit_verification_required":"pre_submit_login_required"):(verification?"submitted_verification_required":"submitted_login_required"),failureCode:verification?"DOUBAO_VERIFICATION_REQUIRED":"DOUBAO_LOGIN_REQUIRED",failureCategory:"authentication",providerMessage:detection.message||statusText,userAction:`请打开 ${account.name} 的豆包窗口完成${verification?"验证":"登录"}，然后点击“继续”。`,error:null,lastHeartbeatAt:checkpointAt,executionCheckpoint:{phase:state,action:verification?"human_verification":"human_login",irreversible:preSubmission?false:task.executionCheckpoint?.irreversible===true,startedAt:task.executionCheckpoint?.startedAt||checkpointAt,updatedAt:checkpointAt,submissionStartedAt:preSubmission?null:(task.executionCheckpoint?.submissionStartedAt||task.evidence?.submittedAt||checkpointAt)}});
  }
  async beginBrowserTask(task) {
    this.tenantId();
    if (!task || task.executionChannel !== "doubao" || !task.accountId) return;
    const account=this.assertAuthorizedAccount({id:task.accountId,name:task.accountName});
    await this.browserRuntime()?.beginTask?.(account, {...task,accountName:account.name});
  }
  syncBrowserTask(task) {
    if (!task || task.executionChannel !== "doubao" || !task.accountId) return;
    this.browserRuntime()?.updateTask?.(task);
  }
  async executeBrowserTask(task, action, request, {submissionUnknown = false} = {}) {
    const timeoutMs=Math.max(10,Number(this.browserTimeouts[action])||DOUBAO_BROWSER_TIMEOUTS[action]||120000);let timer;
    this.tenantId();
    const authorizedRequest=request?.account?{...request,account:this.assertAuthorizedAccount(request.account)}:request;
    try{const result=await Promise.race([this.agentBridge.browser.execute(authorizedRequest),new Promise((_,reject)=>{timer=setTimeout(()=>{const error=Object.assign(new Error(`豆包自动操作超过 ${Math.round(timeoutMs/1000)} 秒未返回，已停止本地等待`),{code:"DOUBAO_EXECUTION_TIMEOUT",category:"execution_timeout",submissionUnknown,submittedVerified:false,safeToRetry:false,notSentVerified:false,quotaConsumed:null,userAction:submissionUnknown?"请打开原账号现场核对是否已经提交；确认前系统不会自动重发。":"系统稍后会继续检查原任务，不会重新发送提示词。"});reject(error);},timeoutMs);})]);this.tenantId();return result;}finally{if(timer)clearTimeout(timer);}
  }
  recoverInterruptedTasks() {
    const snapshot = this.tasks.bootstrap();
    for (const task of snapshot.tasks || []) {
      if (task.deletedAt || task.archivedAt) continue;
      if (task.executionChannel === "model-gateway") {
        if (["generating", "downloading", "verifying", "submission_unknown"].includes(task.state) && ((task.resultUrls || []).length || task.providerJobId || task.clientRequestId)) this.scheduleModelRecovery(task.id, 1500);
        else if (["preparing", "submitting"].includes(task.state)) { const unknown=this.tasks.reportTask(task.id, {state:"submission_unknown",progress:Math.max(15,Number(task.progress||0)),statusText:"客户端重启时模型请求仍在提交，禁止自动重发",error:"无法确认厂商是否已经接收请求；为避免重复扣费，不自动重提",safeToRetry:false,notSentVerified:false,recoveryState:"submission_unknown"});if(unknown.providerJobId||unknown.clientRequestId)this.scheduleModelRecovery(unknown.id,1500); }
        continue;
      }
      if (task.executionChannel !== "doubao") continue;
      if (task.accountId && DOUBAO_RECOVERY_ACCOUNT_STATES.has(task.state)) {
        try { this.assertAuthorizedAccount({id:task.accountId,name:task.accountName}); }
        catch (error) {
          const evidence=task.evidence||{},checkpoint=task.executionCheckpoint||{};
          const hasSubmissionEvidence=task.submittedVerified===true||checkpoint.irreversible===true||Boolean(evidence.prompt||evidence.conversationId||evidence.userMessageId||evidence.requestId||evidence.submittedAt||(task.resultUrls||[]).length||task.resultVid);
          const recoverableBeforeSubmission=!hasSubmissionEvidence&&["queued","preparing","assigned","launching","checking_login","awaiting_quota"].includes(task.state);
          const candidates=this.authorizedCandidates(task.accountCandidates||[]);
          if(recoverableBeforeSubmission&&task.accountSelectionMode==="auto"&&candidates.length){const selected=candidates[0],queued=this.tasks.reportTask(task.id,{state:"queued",stage:"queued",progressMode:"determinate",progress:0,accountId:selected.id,accountName:selected.name,accountCandidates:candidates,statusText:`原账号不属于当前密钥，已安全改用当前密钥账号：${selected.name}`,error:null,safeToRetry:false,notSentVerified:false,recoveryState:"unauthorized_account_reassigned"});this.emitLiveStatus(queued);setTimeout(()=>this.run(queued.id).catch(()=>{}),0);continue;}
          const stopped=this.tasks.reportTask(task.id,{state:"failed",stage:"failed",progressMode:"determinate",progress:0,statusText:"原执行账号不属于当前密钥，已停止恢复",error:"任务保存的豆包账号不在当前密钥的授权账号列表中，系统未打开该账号，也未继续轮询",safeToRetry:false,notSentVerified:!hasSubmissionEvidence,terminalFailureVerified:false,submittedVerified:hasSubmissionEvidence,accountAction:"release",retryMode:"",failureCode:"DOUBAO_ACCOUNT_NOT_AUTHORIZED",failureCategory:"authorization",providerMessage:"当前密钥无权使用原任务账号",userAction:hasSubmissionEvidence?"请核对密钥归属；如需在当前密钥执行，请使用当前账号新建任务。":"请选择当前密钥下的账号新建任务。",quotaConsumed:null,recoveryState:"unauthorized_account_stopped"});this.releaseAccount(task.id);this.emitLiveStatus(stopped);continue;
        }
      }
      const failureEvidence=task.evidence||{};const failedHasSubmissionEvidence=task.submittedVerified===true||Boolean(failureEvidence.prompt||failureEvidence.conversationId||failureEvidence.userMessageId||failureEvidence.requestId||failureEvidence.submittedAt||(task.resultUrls||[]).length||task.resultVid);
      if(task.state==="failed"&&!failedHasSubmissionEvidence&&/没有找到豆包视频模型选择器|没有找到模型：Seedance\s*2\.0\s*(?:Fast|Mini)|豆包视频模型确认失败/.test(String(task.error||""))){const retryable=this.tasks.reportTask(task.id,{state:"failed",statusText:"豆包模型参数未配置成功，本次提示词尚未发送，可安全重试",safeToRetry:true,notSentVerified:true,submittedVerified:false,retryMode:"adjust_parameters",failureCode:"DOUBAO_PARAMETER_CONFIG_FAILED",failureCategory:"parameters",providerMessage:String(task.error||"豆包模型参数配置失败"),userAction:"可调整或保持原模型参数后创建安全重试任务；原任务不会自动重提。",quotaConsumed:false});this.emitLiveStatus(retryable);continue;}
      if (task.state === "awaiting_quota") { this.scheduleQuotaResume(task.id, task.quotaResetAt); continue; }
      if (task.state === "submission_unknown") { this.holdAccount(task);this.scheduleUnknownAudit(task.id,1500); continue; }
      if (["downloading","verifying"].includes(task.state) && (task.resultUrls || []).length) { const review=this.tasks.reportTask(task.id,{state:"paused",stage:"manual_review",progressMode:"paused",progress:Math.max(85,Number(task.progress||0)),statusText:"客户端重启时素材仍在回传，已暂停等待人工选择重新回传或取消",recoveryState:"result_review_required",safeToRetry:false,notSentVerified:false,accountAction:"release",userAction:"可重新回传已有豆包视频，或取消本地回传；不会重新生成视频。"});this.syncBrowserTask(review);this.emitLiveStatus(review);this.releaseAccount(task.id);continue; }
      if (task.state === "queued") {
        const evidence = task.evidence || {};
        const hasSubmissionEvidence = task.submittedVerified === true || Boolean(evidence.prompt && (evidence.conversationId || task.conversationId) && (evidence.submittedAt || task.updatedAt));
        if (hasSubmissionEvidence) {
          const unknown = this.tasks.reportTask(task.id, {state:"submission_unknown",progress:Math.max(15,Number(task.progress||0)),statusText:"客户端重启后发现已有提交证据，禁止自动重发",error:"排队记录包含提交证据，但当前状态无法确认厂商是否已接收；为避免重复生成，不自动重提",safeToRetry:false,notSentVerified:false,recoveryState:"submission_unknown"});
          this.holdAccount(unknown);this.syncBrowserTask(unknown);this.beginBrowserTask(unknown).catch(()=>{});this.scheduleUnknownAudit(unknown.id,1500);
        } else {
          // 排队任务尚未提交，可以安全恢复；runDoubaoWithFailover 仍负责账号级串行和额度锁。
          setTimeout(() => { this.run(task.id).catch(() => {}); }, 0);
        }
        continue;
      }
      if (!["preparing","assigned","launching","checking_login","uploading","configuring","submitting","awaiting_confirmation","generating","verifying"].includes(task.state)) continue;
      const evidence = task.evidence || {};
      const hasSubmissionEvidence = Boolean(evidence.prompt && (evidence.conversationId || task.conversationId) && (evidence.submittedAt || task.updatedAt));
      if (hasSubmissionEvidence && task.state === "generating" && task.conversationId) { this.holdAccount(task);this.beginBrowserTask(task).catch(()=>{});this.scheduleMonitor(task.id, 5000); continue; }
      const checkpoint=task.executionCheckpoint||{},preSubmissionState=["preparing","assigned","launching","checking_login"].includes(task.state),browserAutomationStarted=checkpoint.irreversible===true||Boolean(checkpoint.submissionStartedAt);
      if(preSubmissionState&&!browserAutomationStarted){const queued=this.tasks.reportTask(task.id,{state:"queued",stage:"queued",progressMode:"determinate",progress:0,statusText:"客户端重启时尚未开始提交，已安全恢复排队",error:null,safeToRetry:false,notSentVerified:false,executionAttemptId:"",executionCheckpoint:null,lastHeartbeatAt:new Date().toISOString(),recoveryState:"safe_pre_submit_restart"});this.syncBrowserTask(queued);setTimeout(()=>this.run(queued.id).catch(()=>{}),0);continue;}
      const unknown=this.tasks.reportTask(task.id, {state:"submission_unknown",stage:"manual_review",progressMode:"paused",progress:Math.min(45,Math.max(15,Number(task.progress||0))),statusText:"客户端重启时豆包自动操作未完整返回，已转人工核对",error:"无法确认崩溃前是否已经发送提示词；为避免重复生成和扣费，系统不会自动重提。",safeToRetry:false,notSentVerified:false,submittedVerified:task.submittedVerified===true||hasSubmissionEvidence,accountAction:"hold",recoveryState:"interrupted_browser_automation",failureCode:"DOUBAO_INTERRUPTED_EXECUTION",failureCategory:"execution_interrupted",providerMessage:"豆包自动操作在客户端退出前未完整返回。",userAction:"请打开原账号现场核对：已提交则继续监控，未提交则确认结束保护。",lastHeartbeatAt:new Date().toISOString()});this.holdAccount(unknown);this.syncBrowserTask(unknown);this.beginBrowserTask(unknown).catch(()=>{});this.scheduleUnknownAudit(unknown.id,1500);
    }
  }
  async create(input = {}) {
    this.authorize("generate");
    const tenantId = this.tenantId();
    const channel = String(input.executionChannel || "");
    if (!["doubao", "model-gateway"].includes(channel)) throw new Error("请选择执行通道");
    if (channel === "doubao" && !String(input.accountId || "").trim() && !(Array.isArray(input.accountCandidates) && input.accountCandidates.length)) throw new Error("豆包通道必须选择账号或自动调度账号池");
    if (channel === "model-gateway" && (!String(input.providerId || "").trim() || !String(input.modelId || input.model || "").trim())) throw new Error("模型网关通道必须选择厂商和模型");
    let securedInput = input;
    if (channel === "doubao") {
      securedInput = this.secureDoubaoCreationInput(input);
    }
    const task = this.tasks.createTask({...securedInput, tenantId, executionChannel: channel, modelId: input.modelId || input.model, state: "queued", statusText: "已创建，等待执行"});
    this.run(task.id).catch(() => {});return task;
  }
  emitLiveStatus(value) { this.liveStatusProvider?.({taskId:value.id,title:value.title,creationType:value.creationType,creationSource:value.creationSource,projectId:value.projectId,executionChannel:value.executionChannel,accountId:value.accountId,accountName:value.accountName,providerId:value.providerId,modelId:value.modelId,doubaoModel:value.doubaoModel,ratio:value.ratio,duration:value.duration,conversationId:value.conversationId||"",conversationVid:value.conversationVid||value.conversationId||"",videoVid:value.videoVid||"",state:value.state,stage:value.stage||value.state,progressMode:value.progressMode||"determinate",monitorAttempt:Number(value.monitorAttempt||0),lastCheckedAt:value.lastCheckedAt||null,createdAt:value.createdAt||null,updatedAt:value.updatedAt||null,statusText:value.statusText,progress:value.progress,resultAssetId:value.resultAssetId||"",resultAssetIds:Array.isArray(value.resultAssetIds)?value.resultAssetIds.slice():[],resultItems:Array.isArray(value.resultItems)?value.resultItems.map(item=>({...item})):[],expectedResultCount:Number(value.expectedResultCount||0),recoveredResultCount:Number(value.recoveredResultCount||0),resultVid:value.resultVid||"",resultUrlSource:value.resultUrlSource||"",watermarkFree:typeof value.watermarkFree==="boolean"?value.watermarkFree:null,watermarkFreeError:value.watermarkFreeError||"",fallbackResultVid:value.fallbackResultVid||"",resultType:value.resultType||"",resultText:value.resultText||"",resultUrls:Array.isArray(value.resultUrls)?value.resultUrls.slice():[],terminalFailureVerified:value.terminalFailureVerified===true,outcomeCode:value.outcomeCode||value.failureCode||"",submittedVerified:value.submittedVerified===true,accountAction:value.accountAction||"",retryMode:value.retryMode||"",recoveryState:value.recoveryState||"",failureCode:value.failureCode||"",failureCategory:value.failureCategory||"",providerMessage:value.providerMessage||"",userAction:value.userAction||"",error:value.error||"",quotaConsumed:typeof value.quotaConsumed==="boolean"?value.quotaConsumed:null}); }
  async report(taskId, patch) { this.tenantId();const value = this.tasks.reportTask(taskId, patch);this.tenantId();this.syncBrowserTask(value);this.emitLiveStatus(value); return value; }
  currentTask(taskId) { this.tenantId();return this.tasks.bootstrap().tasks.find(item=>item.id===taskId)||null; }
  resolveTaskReferenceAssets(task) {
    const allAssets=this.tasks.bootstrap().assets||[],assetById=new Map(allAssets.map(item=>[item.id,item])),referenceById=new Map((task.referenceAssets||[]).map(item=>[item.assetId,item]));const output=[];
    for(const assetId of task.assetIds||[]){const publicAsset=assetById.get(assetId);if(!publicAsset)throw Object.assign(new Error(`参考素材不存在：${assetId}`),{providerTerminal:true,terminalFailureVerified:true,safeToRetry:true,notSentVerified:true,code:"DOUBAO_ASSET_MISSING",category:"asset_upload",retryMode:"edit_assets",userAction:"参考素材已丢失，请重新选择人物、场景或道具图片后执行。",quotaConsumed:false});if(publicAsset.type!=="image")continue;let resolved;try{resolved=this.tasks.resolveAsset(assetId)}catch(error){throw Object.assign(error,{providerTerminal:true,terminalFailureVerified:true,safeToRetry:true,notSentVerified:true,code:"DOUBAO_ASSET_MISSING",category:"asset_upload",retryMode:"edit_assets",userAction:"参考图片文件已丢失，请重新选择或生成对应素材后执行。",quotaConsumed:false});}const meta=referenceById.get(assetId)||{};output.push({id:resolved.id,name:resolved.name,originalName:resolved.originalName,type:resolved.type,mime:resolved.mime,size:resolved.size,path:resolved.path,tags:resolved.tags||[],notes:resolved.notes||"",role:meta.role||"",label:meta.label||resolved.name,description:meta.description||"",order:Number(meta.order)||output.length+1});}
    return output.sort((a,b)=>a.order-b.order);
  }
  clearUnknownAudit(taskId) { const timer=this.unknownAuditTimers.get(taskId);if(timer)clearTimeout(timer);this.unknownAuditTimers.delete(taskId);this.unknownAuditAttempts.delete(taskId); }
  scheduleUnknownAudit(taskId, delayMs = 15000) {
    if(this.unknownAuditTimers.has(taskId)||this.cancelledTasks.has(taskId))return;
    const timer=setTimeout(async()=>{this.unknownAuditTimers.delete(taskId);const task=this.currentTask(taskId);if(!task||task.state!=="submission_unknown"||task.deletedAt){this.clearUnknownAudit(taskId);return;}const attempt=(this.unknownAuditAttempts.get(taskId)||0)+1;this.unknownAuditAttempts.set(taskId,attempt);try{const result=await this.auditSubmissionUnknown(task);if(result?.state==="submission_unknown")this.scheduleUnknownAudit(taskId,Math.min(60000,15000+attempt*5000));}catch(error){if(error?.code==="DOUBAO_EXECUTION_TIMEOUT"){await this.protectExecutionTimeout(taskId,error,task);return;}const latest=this.currentTask(taskId);if(latest?.state==="submission_unknown")this.scheduleUnknownAudit(taskId,Math.min(60000,20000+attempt*5000));}},Math.max(10,Number(delayMs)||15000));timer.unref?.();this.unknownAuditTimers.set(taskId,timer);
  }
  async auditSubmissionUnknown(taskInput) {
    const task=this.currentTask(taskInput?.id)||taskInput;if(!task||task.state!=="submission_unknown")return task;
    const key=this.accountKey(task),owner=this.accountOwners.get(key);if(owner&&owner!==task.id)return task;this.holdAccount(task);
    const imageAssets=this.resolveTaskReferenceAssets(task);
    const result=await this.executeBrowserTask(task,"monitor",{action:"monitor",account:{id:task.accountId,name:task.accountName,platform:"豆包"},payload:{jobId:task.id,prompt:task.evidence?.sourcePrompt||task.prompt,conversationId:task.conversationId||task.evidence?.conversationId||"",userMessageId:task.evidence?.userMessageId||"",requestId:task.evidence?.requestId||"",submittedAt:task.evidence?.submittedAt||"",doubaoModel:task.doubaoModel,ratio:task.ratio,duration:task.duration,imageAssetIds:task.assetIds,imageAssets,creationType:task.creationType,terminalProbe:true}},{submissionUnknown:true});
    if(result?.verificationRequired||result?.paused){this.clearUnknownAudit(task.id);return this.report(task.id,{state:"awaiting_verification",progress:25,statusText:"豆包需要人工验证，请完成后继续",conversationId:result.conversationId||task.conversationId||"",error:null});}
    if(result?.quotaExhausted&&result?.notSentVerified){this.clearUnknownAudit(task.id);const error=Object.assign(new Error(result.message||"豆包额度已耗尽"),result);return this.handleMonitorQuotaExhausted(task.id,task,error);}
    if(result?.ok===false&&result?.terminalFailureVerified){this.clearUnknownAudit(task.id);const error=Object.assign(new Error(result.message||"豆包明确结束本次生成"),result);return this.handleProviderTerminalFailure(task.id,error);}
    if(result?.submissionRecovered&&result?.conversationId){
      this.clearUnknownAudit(task.id);
      const recovered=await this.report(task.id,{state:"generating",stage:"monitoring",progressMode:"indeterminate",progress:45,statusText:"已在原豆包会话确认提交，继续监控；未重新发送提示词",conversationId:result.conversationId,submittedVerified:true,error:null,safeToRetry:false,notSentVerified:false,evidence:result.submittedEvidence||task.evidence||null,accountAction:"hold",recoveryState:"submission_recovered"});
      this.holdAccount(recovered);this.beginBrowserTask(recovered).catch(()=>{});this.scheduleMonitor(recovered.id,1000);return recovered;
    }
    return this.currentTask(task.id);
  }
  async handleProviderTerminalFailure(taskId, error) {
    this.clearMonitor(taskId);this.clearUnknownAudit(taskId);
    const retryMode=String(error?.retryMode||"retry_or_edit");
    const statusByMode={edit_prompt:"豆包已拒绝本次内容，请修改提示词后重新提交",edit_assets:"豆包未接受参考素材，请调整素材后重新提交",adjust_parameters:"豆包不支持当前参数，请调整模型或参数后重新提交",reauthenticate:"豆包登录已失效，请重新登录后执行",retry_later:"豆包服务暂时繁忙，请稍后重新执行",retry_or_edit:"豆包已明确结束本次生成，可检查内容后重新执行"};
    const failed=await this.report(taskId,{state:"failed",stage:"failed",progressMode:"determinate",progress:0,statusText:statusByMode[retryMode]||statusByMode.retry_or_edit,error:String(error?.providerMessage||error?.message||error),monitorError:"",monitorProbe:null,safeToRetry:error?.safeToRetry!==false,notSentVerified:error?.notSentVerified===true,terminalFailureVerified:true,outcomeCode:String(error?.outcomeCode||error?.code||"DOUBAO_PROVIDER_TERMINAL"),submittedVerified:error?.submittedVerified===true,accountAction:"release",retryMode,requiresPromptEdit:error?.requiresPromptEdit===true,failureCode:String(error?.code||"DOUBAO_PROVIDER_TERMINAL"),failureCategory:String(error?.category||"provider_generation"),providerMessage:String(error?.providerMessage||error?.message||error),userAction:String(error?.userAction||statusByMode[retryMode]||statusByMode.retry_or_edit),quotaConsumed:typeof error?.quotaConsumed==="boolean"?error.quotaConsumed:null,recoveryState:"provider_terminal_failure",failureEvidence:error?.evidence||null});
    this.releaseAccount(taskId);
    return failed;
  }
  async protectMonitorSubmissionUnknown(taskId, error, attempt = 0) {
    this.clearMonitor(taskId);
    const current=this.currentTask(taskId);
    if(!current)return null;
    const message=String(error?.message||error||"无法恢复当前豆包会话");
    const protectedTask=await this.report(taskId,{state:"submission_unknown",stage:"manual_review",progressMode:"paused",progress:Math.max(15,Number(current.progress||0)),monitorAttempt:Number(attempt||current.monitorAttempt||0),lastCheckedAt:new Date().toISOString(),statusText:"连续无法恢复原豆包会话，已停止自动监控，请打开现场人工核对",error:message,monitorError:message,monitorProbe:error?.monitorProbe||current.monitorProbe||null,safeToRetry:false,notSentVerified:false,submittedVerified:current.submittedVerified===true||Boolean(current.conversationId||current.evidence?.conversationId),accountAction:"hold",recoveryState:"conversation_restore_failed",failureCode:"DOUBAO_CONVERSATION_RESTORE_FAILED",failureCategory:"monitor_binding",providerMessage:"系统无法稳定恢复本任务绑定的豆包会话，未自动判定成功或失败。",userAction:"请打开原账号现场，选择确认豆包已失败、确认已提交继续监控，或确认未提交结束保护。"});
    this.holdAccount(protectedTask);
    this.browserRuntime()?.hideAccount?.(protectedTask.accountId);
    return protectedTask;
  }
  async protectExecutionTimeout(taskId,error,taskInput=null) { this.clearMonitor(taskId);this.clearUnknownAudit(taskId);const current=this.currentTask(taskId)||taskInput;if(!current)return null;const protectedTask=await this.report(taskId,{state:"submission_unknown",stage:"manual_review",progressMode:"paused",progress:Math.max(15,Number(current.progress||0)),lastCheckedAt:new Date().toISOString(),statusText:"豆包自动操作超时，已停止继续操作并转人工核对",error:String(error?.message||error||"豆包自动操作超时"),monitorError:String(error?.message||error||"豆包自动操作超时"),safeToRetry:false,notSentVerified:false,submittedVerified:current.submittedVerified===true||Boolean(current.conversationId||current.evidence?.conversationId),accountAction:"hold",recoveryState:"execution_timeout_manual_review",failureCode:"DOUBAO_EXECUTION_TIMEOUT",failureCategory:"execution_timeout",providerMessage:"豆包窗口在限定时间内没有返回可靠结果，系统已停止发起新的浏览器操作。",userAction:"请打开原账号现场核对：已提交则继续监控，未提交则确认结束保护。"});this.holdAccount(protectedTask);return protectedTask; }
  assertTaskNotCancelled(taskId) { const task=this.currentTask(taskId);if(this.cancelledTasks.has(taskId)||task?.state==="cancelled"){const error=new Error("任务已取消");error.code="TASK_CANCELLED";throw error;}return task; }
  accountKey(task) { return `doubao:${this.tenantId()}:${String(task.accountId || '')}`; }
  accountLoad(accountId) { const key=this.accountKey({accountId});let load=0;for(const lease of this.accountLeases.values())if(lease?.key===key)load+=1;return load; }
  accountHumanLocked(accountId) { const key=this.accountKey({accountId}),ownerId=this.accountOwners.get(key);if(!ownerId)return false;const owner=this.currentTask(ownerId);if(!owner)return false;return ["awaiting_login","awaiting_verification","submission_unknown"].includes(owner.state)||(owner.accountAction==="hold"&&owner.stage==="manual_review"); }
  async acquireAccount(task) { const key=this.accountKey(task); if(this.accountOwners.get(key)===task.id)return; const previous=this.accountQueues.get(key)||Promise.resolve(); let unlock; const gate=new Promise(resolve=>{unlock=resolve}); const tail=previous.catch(()=>{}).then(()=>gate); this.accountQueues.set(key,tail); this.accountLeases.set(task.id,{key,unlock,tail}); if(this.accountOwners.has(key)) await this.report(task.id,{state:"queued",progress:0,statusText:"等待豆包账号可用，同一账号任务将串行执行"}); await previous.catch(()=>{}); const latest=this.tasks.bootstrap().tasks.find(item=>item.id===task.id); if(this.cancelledTasks.has(task.id)||latest?.state==="cancelled"){this.releaseAccount(task.id);throw new Error("任务已取消");} this.accountOwners.set(key,task.id); }
  holdAccount(task) { const key=this.accountKey(task);if(this.accountOwners.has(key))return;let unlock;const gate=new Promise(resolve=>{unlock=resolve});this.accountOwners.set(key,task.id);this.accountQueues.set(key,gate);this.accountLeases.set(task.id,{key,unlock,tail:gate}); }
  releaseAccount(taskId) { const lease=this.accountLeases.get(taskId);if(!lease){for(const [key,owner] of this.accountOwners.entries())if(owner===taskId)this.accountOwners.delete(key);return;}this.accountLeases.delete(taskId);if(this.accountOwners.get(lease.key)===taskId)this.accountOwners.delete(lease.key);lease.unlock();if(this.accountQueues.get(lease.key)===lease.tail)this.accountQueues.delete(lease.key); }
  clearMonitor(taskId) { const timer=this.monitorTimers.get(taskId);if(timer)clearTimeout(timer);this.monitorTimers.delete(taskId);this.monitorAttempts.delete(taskId);this.monitorRestoreFailures.delete(taskId); }
  clearQuotaTimer(taskId) { const timer=this.quotaTimers.get(taskId);if(timer)clearTimeout(timer);this.quotaTimers.delete(taskId); }
  clearAccountAvailabilityTimer(taskId) { const timer=this.accountAvailabilityTimers.get(taskId);if(timer)clearTimeout(timer);this.accountAvailabilityTimers.delete(taskId); }
  scheduleAccountAvailabilityResume(taskId, delayMs = 3000) { if(this.accountAvailabilityTimers.has(taskId)||this.cancelledTasks.has(taskId))return;const timer=setTimeout(async()=>{this.accountAvailabilityTimers.delete(taskId);const task=this.currentTask(taskId);if(!task||task.deletedAt||task.state!=="queued"||task.executionChannel!=="doubao"||task.accountSelectionMode!=="auto")return;try{await this.run(taskId);}catch{}},Math.max(100,Number(delayMs)||3000));timer.unref?.();this.accountAvailabilityTimers.set(taskId,timer); }
  clearModelRecovery(taskId) { const timer=this.modelRecoveryTimers.get(taskId);if(timer)clearTimeout(timer);this.modelRecoveryTimers.delete(taskId);this.modelRecoveryAttempts.delete(taskId); }
  scheduleModelRecovery(taskId, delayMs = 5000) {
    if (this.modelRecoveryTimers.has(taskId) || this.cancelledTasks.has(taskId)) return;
    const timer=setTimeout(async()=>{
      this.modelRecoveryTimers.delete(taskId);
      const task=this.currentTask(taskId);
      if(!task||task.executionChannel!=="model-gateway"||!["generating","downloading","verifying","submission_unknown"].includes(task.state)||task.deletedAt){this.clearModelRecovery(taskId);return;}
      const attempt=(this.modelRecoveryAttempts.get(taskId)||0)+1;this.modelRecoveryAttempts.set(taskId,attempt);
      try { await this.recoverModelResult(task); }
      catch(error) {
        const latest=this.currentTask(taskId);
        if(latest&&["generating","downloading","verifying","submission_unknown"].includes(latest.state)){
          if(attempt>=MODEL_QUERY_MAX_ATTEMPTS){await this.report(taskId,{state:"paused",stage:"manual_review",progressMode:"paused",progress:Math.max(15,Number(latest.progress||0)),statusText:"连续无法取得厂商任务状态，已暂停并等待人工处理",error:String(error.message||error),recoveryState:"result_review_required",safeToRetry:false,notSentVerified:false,userAction:"可修改结果地址、继续查询、仅重试回传或取消本地追踪。"});this.clearModelRecovery(taskId);}
          else{await this.report(taskId,{state:latest.state,progressMode:latest.state==="generating"?"indeterminate":latest.state==="submission_unknown"?"paused":"determinate",progress:latest.state==="submission_unknown"?Math.max(15,Number(latest.progress||0)):Math.max(70,Number(latest.progress||0)),statusText:`厂商状态查询暂时失败，正在第 ${attempt} 次自动恢复`,error:String(error.message||error),recoveryState:"query_retrying",safeToRetry:false,notSentVerified:false});this.scheduleModelRecovery(taskId,Math.min(60000,5000+attempt*5000));}
        }
      }
    },Math.max(10,Number(delayMs)||5000));
    timer.unref?.();this.modelRecoveryTimers.set(taskId,timer);
  }
  dispose() { this.disposed=true;for(const timer of this.monitorTimers.values())clearTimeout(timer);for(const timer of this.unknownAuditTimers.values())clearTimeout(timer);for(const timer of this.quotaTimers.values())clearTimeout(timer);for(const timer of this.accountAvailabilityTimers.values())clearTimeout(timer);for(const timer of this.modelRecoveryTimers.values())clearTimeout(timer);for(const lease of this.accountLeases.values())try{lease.unlock();}catch{}for(const resume of this.modelDownloadQueue.splice(0))try{resume();}catch{}this.monitorTimers.clear();this.monitorAttempts.clear();this.monitorRestoreFailures.clear();this.unknownAuditTimers.clear();this.unknownAuditAttempts.clear();this.quotaTimers.clear();this.accountAvailabilityTimers.clear();this.modelRecoveryTimers.clear();this.modelRecoveryAttempts.clear();this.modelResultRuns.clear();this.doubaoResultRuns.clear();this.accountLeases.clear();this.accountOwners.clear();this.accountQueues.clear(); }
  scheduleQuotaResume(taskId, resetAt) {
    this.clearQuotaTimer(taskId);const target=Date.parse(resetAt||"");const delay=Math.max(1000,(Number.isFinite(target)?target:Date.now()+60000)-Date.now()+500);
    const timer=setTimeout(async()=>{this.quotaTimers.delete(taskId);const task=this.currentTask(taskId);if(!task||task.state!=="awaiting_quota"||task.deletedAt)return;try{await this.report(taskId,{state:"queued",progress:0,statusText:"豆包每日额度已于北京时间零点刷新，任务重新进入调度",quotaResetAt:null,error:null});await this.run(taskId);}catch{}},Math.min(delay,2147483647));timer.unref?.();this.quotaTimers.set(taskId,timer);
  }
  doubaoCandidates(task) {
    const stored=Array.isArray(task.accountCandidates)?task.accountCandidates:[];const current=task.accountId?{id:task.accountId,name:task.accountName||task.accountId,platform:"豆包"}:null;
    if(task.accountSelectionMode!=="auto")return current?[this.assertAuthorizedAccount(current)]:[];const list=[...(current?[current]:[]),...stored];const authorized=this.authorizedCandidates(list);const seen=new Set();return authorized.filter(item=>item?.id&&!seen.has(item.id)&&seen.add(item.id));
  }
  selectDoubaoAccount(task, excluded=new Set()) { const eligible=this.doubaoCandidates(task).filter(item=>!excluded.has(item.id)&&!this.tasks.doubaoQuotaBlock?.(item.id,task.doubaoModel));if(task.accountSelectionMode!=="auto")return eligible[0]||null;return eligible.map((item,index)=>({item,index,load:this.accountLoad(item.id)})).filter(entry=>!this.accountHumanLocked(entry.item.id)).sort((a,b)=>a.load-b.load||a.index-b.index)[0]?.item||null; }
  async waitForAccountAvailability(task) { this.releaseAccount(task.id);const waiting=await this.report(task.id,{state:"queued",stage:"queued",progressMode:"determinate",progress:0,statusText:"所有候选豆包账号都在等待人工处理，任务保持排队",error:null,safeToRetry:false,notSentVerified:false});this.scheduleAccountAvailabilityResume(task.id);return waiting; }
  async waitForQuota(task) {
    this.clearAccountAvailabilityTimer(task.id);this.releaseAccount(task.id);const ids=this.doubaoCandidates(task).map(item=>item.id);const resetAt=this.tasks.nextDoubaoQuotaReset?.(ids,task.doubaoModel)||new Date(Date.now()+3600000).toISOString();const waiting=await this.report(task.id,{state:"awaiting_quota",progress:0,statusText:`可用豆包账号的 ${task.doubaoModel} 今日额度均已耗尽，将在 ${new Date(resetAt).toLocaleString("zh-CN",{timeZone:"Asia/Shanghai"})} 后自动继续`,quotaResetAt:resetAt,error:null,safeToRetry:false,notSentVerified:false});this.scheduleQuotaResume(task.id,resetAt);return waiting;
  }
  async handleMonitorQuotaExhausted(taskId, task, error) {
    this.clearMonitor(taskId);this.clearUnknownAudit(taskId);
    const current=this.currentTask(taskId)||task;const account={id:current.accountId,name:current.accountName||current.accountId,platform:"豆包"};const reason=String(error.message||error);
    const block=this.tasks.markDoubaoQuotaExhausted?.(account,{model:current.doubaoModel,reason});const failures=[...(current.quotaFailures||[]),{at:new Date().toISOString(),accountId:account.id,accountName:account.name,doubaoModel:current.doubaoModel,reason,resetAt:block?.resetAt||null,notSentVerified:true,detectedDuring:"monitor"}];
    const queued=await this.report(taskId,{state:"queued",progress:0,statusText:`${account.name} 的 ${current.doubaoModel} 今日额度已耗尽，已停止当前账号并准备切换`,quotaFailures:failures,quotaResetAt:block?.resetAt||null,conversationId:"",evidence:null,error:null,safeToRetry:true,notSentVerified:true});
    this.releaseAccount(taskId);
    if(queued.accountSelectionMode!=="auto")return this.waitForQuota(queued);
    return this.runDoubaoWithFailover(taskId);
  }
  scheduleMonitor(taskId, delayMs = 15000) {
    if (this.monitorTimers.has(taskId) || this.cancelledTasks.has(taskId)) return;
    const timer=setTimeout(async()=>{
      this.monitorTimers.delete(taskId);
      const task=this.tasks.bootstrap().tasks.find(item=>item.id===taskId);
      if(!task||task.state!=="generating"||task.deletedAt){this.clearMonitor(taskId);return;}
      const attempt=(this.monitorAttempts.get(taskId)||0)+1;this.monitorAttempts.set(taskId,attempt);
      try {
        const checkedAt=new Date().toISOString();await this.report(taskId,{state:"generating",stage:"generating",progressMode:"indeterminate",progress:Math.max(45,Number(task.progress||0)),monitorAttempt:attempt,lastCheckedAt:checkedAt,statusText:`豆包仍在生成；已完成第 ${attempt} 次安全检查，未发现终止或结果`,stepGroup:"doubao-monitor-heartbeat",replaceStepGroup:true});
        await this.acquireAccount(task);
        await this.runDoubao(task,"monitor");
        this.monitorRestoreFailures.delete(taskId);
        const latest=this.tasks.bootstrap().tasks.find(item=>item.id===taskId);
        if(latest?.state==="generating")this.scheduleMonitor(taskId,Math.min(60000,15000+attempt*5000));else this.clearMonitor(taskId);
      } catch(error) {
        if(error?.quotaExhausted===true&&error?.notSentVerified===true){await this.handleMonitorQuotaExhausted(taskId,task,error);return;}
        if(error?.terminalFailureVerified===true){await this.handleProviderTerminalFailure(taskId,error);return;}
        if(error?.code==="DOUBAO_EXECUTION_TIMEOUT"){await this.protectExecutionTimeout(taskId,error,task);return;}
        if(error?.code==="DOUBAO_CONVERSATION_RESTORE_FAILED"){
          const restoreFailures=(this.monitorRestoreFailures.get(taskId)||0)+1;this.monitorRestoreFailures.set(taskId,restoreFailures);
          if(restoreFailures>=3){await this.protectMonitorSubmissionUnknown(taskId,error,attempt);return;}
          const latest=this.tasks.bootstrap().tasks.find(item=>item.id===taskId);
          if(latest?.state==="generating"){
            await this.report(taskId,{state:"generating",stage:"monitoring",progressMode:"indeterminate",progress:Math.max(45,Number(latest.progress||0)),monitorAttempt:attempt,lastCheckedAt:new Date().toISOString(),statusText:`连续第 ${restoreFailures} 次无法恢复原豆包会话；达到 3 次后将停止自动监控并转人工核对`,monitorError:String(error.message||error),monitorProbe:error.monitorProbe||latest.monitorProbe||null,recoveryState:"conversation_restore_retrying"});
            this.scheduleMonitor(taskId,Math.min(60000,20000+attempt*5000));
          }
          return;
        }
        this.monitorRestoreFailures.delete(taskId);
        const latest=this.tasks.bootstrap().tasks.find(item=>item.id===taskId);
        if(latest?.state==="generating"){
          await this.report(taskId,{state:"generating",stage:"monitoring",progressMode:"indeterminate",progress:Math.max(45,Number(latest.progress||0)),monitorAttempt:attempt,lastCheckedAt:new Date().toISOString(),statusText:`第 ${attempt} 次检查暂未取得新信号，稍后自动恢复当前会话继续监控`,monitorError:String(error.message||error)});
          this.scheduleMonitor(taskId,Math.min(60000,20000+attempt*5000));
        } else this.clearMonitor(taskId);
      }
    },Math.max(10,Number(delayMs)||15000));
    timer.unref?.();this.monitorTimers.set(taskId,timer);
  }
  async run(taskId) {
    this.authorize("generate");
    if (this.running.has(taskId)) return this.running.get(taskId);
    const promise = this._run(taskId).finally(() => this.running.delete(taskId)); this.running.set(taskId, promise); return promise;
  }
  async _run(taskId) {
    this.tenantId();
    const task = this.tasks.bootstrap().tasks.find(item => item.id === taskId); if (!task) throw new Error("任务不存在");
    try {
      if (task.executionChannel === "model-gateway") { await this.report(taskId, {state: "preparing", progress: 5, statusText: "正在准备模型网关"}); return await this.runModel(task); }
      return await this.runDoubaoWithFailover(taskId);
    } catch (error) {
      if(["TENANT_CONTEXT_CHANGED","ORCHESTRATOR_DISPOSED","AGENT_STOPPED","AGENT_CONTEXT_CHANGED"].includes(error?.code))throw error;
      const latest=this.tasks.bootstrap().tasks.find(item=>item.id===taskId);if(latest?.state==="cancelled"||error?.code==="TASK_PAUSED"){this.releaseAccount(taskId);return latest;}
      const message = String(error.message || error); const submissionUnknown = error?.submissionUnknown===true || message.startsWith("提交状态未知");
      if(error?.terminalFailureVerified===true){const failed=await this.handleProviderTerminalFailure(taskId,error);throw Object.assign(error,{task:failed});}
      const notSentVerified=!submissionUnknown&&error?.notSentVerified===true,safeToRetry=notSentVerified&&error?.safeToRetry!==false;this.clearMonitor(taskId);const timeoutProtection=error?.code==="DOUBAO_EXECUTION_TIMEOUT"&&task.executionChannel==="doubao";const failedOrUnknown=await this.report(taskId, {state: submissionUnknown ? "submission_unknown" : "failed",stage:timeoutProtection?"manual_review":undefined,progressMode:timeoutProtection?"paused":undefined, progress: submissionUnknown ? Math.max(15,Number(latest?.progress||0)) : 0, error: message, statusText: timeoutProtection?"豆包自动操作超时，已停止继续操作并转人工核对":submissionUnknown ? (task.executionChannel==="model-gateway"?"请求返回超时，正在通过厂商任务接口自动核对":"提交状态未知，账号已锁定等待人工确认") : notSentVerified?"执行前配置失败，本次请求未提交，可安全重试":"执行失败", clientRequestId:error?.clientRequestId||latest?.clientRequestId||task.clientRequestId||"",providerJobId:error?.providerJobId||latest?.providerJobId||"",resultType:error?.resultType||latest?.resultType||task.creationType||"",recoveryState:timeoutProtection?"execution_timeout_manual_review":submissionUnknown?"submission_unknown":"",accountAction:timeoutProtection?"hold":undefined,safeToRetry,notSentVerified,retryMode:error?.retryMode||latest?.retryMode||"",failureCode:error?.code||latest?.failureCode||"",failureCategory:error?.category||latest?.failureCategory||"",providerMessage:error?.providerMessage||message,userAction:error?.userAction||"",quotaConsumed:typeof error?.quotaConsumed==="boolean"?error.quotaConsumed:null,evidence:submissionUnknown&&task.executionChannel==="model-gateway"?{...(latest?.evidence||{}),tenantId:this.tenantId(),providerId:task.providerId,modelId:task.modelId,clientRequestId:error?.clientRequestId||latest?.clientRequestId||task.clientRequestId||"",providerJobId:error?.providerJobId||latest?.providerJobId||"",submissionStartedAt:latest?.evidence?.submissionStartedAt||new Date().toISOString()}:latest?.evidence});if(timeoutProtection)this.holdAccount(failedOrUnknown);else if(submissionUnknown&&task.executionChannel==="doubao")this.scheduleUnknownAudit(taskId,5000);if(submissionUnknown&&task.executionChannel==="model-gateway"&&(failedOrUnknown.providerJobId||failedOrUnknown.clientRequestId))this.scheduleModelRecovery(taskId,1500);if(!submissionUnknown)this.releaseAccount(taskId);
      throw error;
    }
  }
  async runDoubaoWithFailover(taskId) {
    this.authorize("generate");
    this.clearAccountAvailabilityTimer(taskId);
    const excluded=new Set();
    while(true){
      this.authorize("generate");
      let task=this.assertTaskNotCancelled(taskId);const candidates=this.doubaoCandidates(task);if(!candidates.length)throw Object.assign(new Error("当前密钥下没有可执行本任务的豆包账号"),{code:"DOUBAO_ACCOUNT_NOT_AUTHORIZED",notSentVerified:true,safeToRetry:false,category:"authorization",userAction:"请在豆包账号中心添加当前密钥自己的账号后重新创建任务。",quotaConsumed:false});const quotaEligible=candidates.filter(item=>!excluded.has(item.id)&&!this.tasks.doubaoQuotaBlock?.(item.id,task.doubaoModel));if(!quotaEligible.length)return this.waitForQuota(task);const inspected=await this.inspectDoubaoCandidates(task,excluded);if(!inspected.length)return this.waitForAccountAvailability(task);const selection=this.chooseDetectedDoubaoAccount(task,inspected);if(!selection)return this.waitForAccountAvailability(task);const account=selection.account;
      const assigned={...task,accountId:account.id,accountName:account.name};const acquisition=this.acquireAccount(assigned);const loadBeforeAssignment=Math.max(0,this.accountLoad(account.id)-1);
      if(task.accountSelectionMode==="auto"||task.accountId!==account.id||task.accountName!==account.name)task=await this.report(taskId,{state:"queued",progress:0,accountId:account.id,accountName:account.name,statusText:`已按最小负载调度豆包账号：${account.name}（当前负载 ${loadBeforeAssignment}）`});
      await acquisition;
      if(selection.waitState)return this.waitForDoubaoAuthentication(task,account,selection.detection,{preSubmission:true});
      try{
        this.assertTaskNotCancelled(taskId);await this.beginBrowserTask(task);this.assertTaskNotCancelled(taskId);
        const attempts=[...(task.accountAttempts||[]),{at:new Date().toISOString(),accountId:account.id,accountName:account.name,doubaoModel:task.doubaoModel,ratio:task.ratio,duration:task.duration,status:"started"}];
        const attemptId=this.id(),startedAt=new Date().toISOString();task=await this.report(taskId,{state:"preparing",progress:5,statusText:`豆包账号 ${account.name} 已就绪，正在准备 ${task.doubaoModel}`,accountAttempts:attempts,quotaResetAt:null,error:null,safeToRetry:false,notSentVerified:false,executionAttemptId:attemptId,lastHeartbeatAt:startedAt,executionCheckpoint:{phase:"preparing",action:"account_acquired",irreversible:false,startedAt,updatedAt:startedAt}});
        return await this.runDoubao(task);
      }catch(error){
        if(error?.quotaExhausted===true&&error?.notSentVerified===true){
          const current=this.currentTask(taskId)||task;const block=this.tasks.markDoubaoQuotaExhausted?.(account,{model:current.doubaoModel,reason:String(error.message||error)});const failures=[...(current.quotaFailures||[]),{at:new Date().toISOString(),accountId:account.id,accountName:account.name,doubaoModel:current.doubaoModel,reason:String(error.message||error),resetAt:block?.resetAt||null,notSentVerified:true,detectedDuring:"submit"}];
          await this.report(taskId,{state:"queued",progress:0,statusText:`${account.name} 的 ${current.doubaoModel} 今日额度已耗尽，正在切换下一个豆包账号`,quotaFailures:failures,quotaResetAt:block?.resetAt||null,error:null,safeToRetry:true,notSentVerified:true});this.releaseAccount(taskId);excluded.add(account.id);if(current.accountSelectionMode!=="auto")return this.waitForQuota(this.currentTask(taskId)||current);continue;
        }
        throw error;
      }
    }
  }
  async runModel(task) {
    this.authorize("generate");
    await this.liveViewProvider?.({taskId:task.id,title:task.title,executionChannel:"model-gateway",providerId:task.providerId,modelId:task.modelId,state:task.state,statusText:task.statusText});
    const clientRequestId=task.clientRequestId||this.id(),submissionStartedAt=new Date().toISOString();
    await this.report(task.id, {state: "submitting", progress: 15, statusText: "正在提交模型网关请求",clientRequestId,evidence:{tenantId:this.tenantId(),providerId:task.providerId,modelId:task.modelId,clientRequestId,submissionStartedAt}});
    const parameters = {...(task.parameters && typeof task.parameters === "object" ? task.parameters : task.modelParameters && typeof task.modelParameters === "object" ? task.modelParameters : {})};
    if(task.generationMode&&!parameters.mode)parameters.mode=task.generationMode;
    if (task.ratio && task.ratio !== "自动") parameters.aspect_ratio = task.ratio;
    if (task.duration) parameters.seconds = Number(String(task.duration).replace(/s$/i,"")) || task.duration;
    if (task.resolution) parameters.resolution = task.resolution;
    const assets=(task.assetIds||[]).map(assetId=>{try{return this.tasks.resolveAsset(assetId)}catch{return null}}).filter(Boolean);
    this.authorize("generate");
    const result = await this.modelGateway.generate(task.providerId, task.modelId, {prompt: task.prompt, parameters, assets, assetIds: task.assetIds || [],clientRequestId});
    this.assertTaskNotCancelled(task.id);
    const submittedAt=new Date().toISOString();const persistedUrls=(result.urls||[]).filter(value=>!/^data:/i.test(String(value||""))).slice(0,20);
    await this.report(task.id, {state: result.pending?"generating":"verifying",progressMode:result.pending?"indeterminate":"determinate", progress: result.pending?45:80, statusText: result.pending?"厂商已接收任务，正在等待生成结果":"模型响应已返回，正在校验结果", providerId: result.providerId, modelId: result.modelId,clientRequestId:result.clientRequestId||clientRequestId,resultType:result.type,resultText:result.type==="text"?result.content:"",resultUrls:persistedUrls,expectedResultCount:Number(result.expectedResultCount||persistedUrls.length||0),providerJobId:result.providerJobId||"",recoveryState:result.pending?"provider_processing":"response_received",error:null,evidence: {tenantId: this.tenantId(), providerId: result.providerId, modelId: result.modelId,clientRequestId:result.clientRequestId||clientRequestId, providerJobId:result.providerJobId||"",submissionStartedAt,submittedAt}});
    if (result.pending) { this.scheduleModelRecovery(task.id,5000);return this.currentTask(task.id); }
    if (result.type === "text") {
      if (task.conversationId) this.tasks.updateConversation(task.conversationId, {content: result.content, versionLabel: `模型生成 · ${result.modelId}`});
      const root=this.dataRootProvider?.();if(!root)throw new Error("租户数据目录不可用");
      const directory=path.join(root,"downloads");fs.mkdirSync(directory,{recursive:true});
      const safeTitle=String(task.title||"模型文本结果").replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").replace(/\s+/g," ").trim().slice(0,48)||"模型文本结果";
      const target=path.join(directory,`${safeTitle}-${task.id.slice(0,8)}.txt`);fs.writeFileSync(target,String(result.content||""),"utf8");
      const imported=this.tasks.importAssets({projectId:task.projectId,paths:[target],source:"model-gateway-generation"})[0];if(!imported)throw new Error("模型文本结果无法导入素材中心");
      const named=this.tasks.updateAsset?this.tasks.updateAsset(imported.id,generatedAssetMetadata(task,"text","model-gateway")):imported;
      const completed=this.tasks.completeTask(task.id,{resultAssetId:named.id,resultType:"text",resultUrls:[],evidence:{tenantId:this.tenantId(),providerId:result.providerId,modelId:result.modelId,submittedAt,responseType:"text",completedAt:new Date().toISOString()}});this.emitLiveStatus(completed);return completed;
    }
    if (!result.urls?.length) throw new Error("模型已响应，但没有返回可回填的图片或视频地址");
    return this.recoverModelResult({...this.currentTask(task.id),resultUrls:result.urls});
  }
  recoverModelResult(taskInput) {
    const taskId=String(taskInput?.id||"");if(this.modelResultRuns.has(taskId))return this.modelResultRuns.get(taskId);const promise=this._recoverModelResult(taskInput).finally(()=>this.modelResultRuns.delete(taskId));this.modelResultRuns.set(taskId,promise);return promise;
  }
  resultItemKey(task,url,index) { return crypto.createHash("sha256").update(`${task.providerJobId||task.clientRequestId||task.id}|${index}|${url}`).digest("hex").slice(0,32); }
  buildResultItems(task,urls,type) {
    const existing=Array.isArray(task.resultItems)?task.resultItems:[],byKey=new Map(existing.map(item=>[item.key,item])),byUrl=new Map(existing.map(item=>[item.url,item]));return [...new Set(urls.map(value=>String(value||"").trim()).filter(Boolean))].slice(0,20).map((url,index)=>{const key=this.resultItemKey(task,url,index),prior=byKey.get(key)||byUrl.get(url)||{};return{key,index,url,type,status:prior.status||"pending",assetId:prior.assetId||"",attempts:Number(prior.attempts||0),lastError:prior.lastError||"",checksum:prior.checksum||"",bytes:Number(prior.bytes||0),required:prior.required!==false,updatedAt:prior.updatedAt||null};});
  }
  checkpointResultItem(taskId,item,expectedResultCount) {
    if(typeof this.tasks.checkpointModelResultItem==="function")return this.tasks.checkpointModelResultItem(taskId,{item,expectedResultCount});const current=this.currentTask(taskId),items=Array.isArray(current?.resultItems)?current.resultItems.map(value=>({...value})):[],index=items.findIndex(value=>value.key===item.key);if(index>=0)items[index]={...items[index],...item};else items.push(item);const resultAssetIds=[...new Set(items.filter(value=>value.status==="imported"&&value.assetId).map(value=>value.assetId))];return this.tasks.reportTask(taskId,{resultItems:items,resultAssetIds,expectedResultCount,recoveredResultCount:resultAssetIds.length});
  }
  async withModelDownloadSlot(operation) { this.tenantId();if(this.modelDownloadActive>=3)await new Promise(resolve=>this.modelDownloadQueue.push(resolve));else this.modelDownloadActive+=1;this.tenantId();try{const result=await operation();this.tenantId();return result;}finally{const next=this.modelDownloadQueue.shift();if(next)next();else this.modelDownloadActive=Math.max(0,this.modelDownloadActive-1);} }
  async importModelResultItem(task,item,total) {
    if(item.status==="imported"&&item.assetId)return item;const downloading={...item,status:"downloading",lastError:"",updatedAt:new Date().toISOString()};this.checkpointResultItem(task.id,downloading,total);
    try{const downloaded=await this.withModelDownloadSlot(()=>this.downloadModelResult(item.url,task.id,item.type,item.index,item.key)),file=downloaded.path;const imported=this.tasks.importAssets({projectId:task.projectId,paths:[file],source:"model-gateway-generation",dedupeKey:item.key})[0];if(!imported)throw new Error("模型结果无法导入素材中心");const metadata=generatedAssetMetadata(task,item.type,"model-gateway");if(total>1)metadata.name=`${metadata.name}-${item.index+1}`.slice(0,120);const named=this.tasks.updateAsset?this.tasks.updateAsset(imported.id,metadata):imported;const completed={...downloading,status:"imported",assetId:named.id,attempts:Number(item.attempts||0),lastError:"",bytes:downloaded.bytes,checksum:downloaded.checksum,updatedAt:new Date().toISOString()};this.checkpointResultItem(task.id,completed,total);return completed;}
    catch(error){const failed={...downloading,status:"failed",attempts:Number(item.attempts||0)+1,lastError:String(error.message||error),updatedAt:new Date().toISOString()};this.checkpointResultItem(task.id,failed,total);return failed;}
  }
  async _recoverModelResult(taskInput) {
    let task=this.currentTask(taskInput?.id)||taskInput;if(!task)throw new Error("待恢复的模型任务不存在");if(task.state==="cancelled"||this.cancelledTasks.has(task.id))return task;
    let urls=Array.isArray(taskInput?.resultUrls)&&taskInput.resultUrls.length?taskInput.resultUrls:(task.resultUrls||[]),providerExpected=Number(taskInput?.expectedResultCount||task.expectedResultCount||0);
    if(!urls.length&&!task.providerJobId&&!task.clientRequestId){this.clearModelRecovery(task.id);if(task.state==="submission_unknown")return task;return this.report(task.id,{state:"submission_unknown",progressMode:"paused",progress:Math.max(15,Number(task.progress||0)),statusText:"缺少厂商任务标识，已停止自动重发",error:"无法通过接口定位本次请求；为避免重复扣费，不自动重新提交",recoveryState:"query_identifier_missing",safeToRetry:false,notSentVerified:false});}
    if(!urls.length&&(task.providerJobId||task.clientRequestId)){
      if(typeof this.modelGateway.queryGeneration!=="function")throw new Error("当前模型适配器不支持查询厂商任务");const status=await this.modelGateway.queryGeneration(task.providerId,task.modelId,{providerJobId:task.providerJobId,clientRequestId:task.clientRequestId,type:task.resultType||task.creationType});
      if(status.supported===false){this.clearModelRecovery(task.id);return this.report(task.id,{state:"submission_unknown",progressMode:"paused",progress:Math.max(15,Number(task.progress||0)),statusText:"当前厂商未提供可用的任务查询接口，已停止自动重发",error:status.error||"无法通过接口确认厂商是否已接收请求",recoveryState:"query_unsupported",safeToRetry:false,notSentVerified:false});}
      if(status.notFound){this.clearModelRecovery(task.id);return this.report(task.id,{state:"failed",progress:0,statusText:status.notSentVerified?"厂商明确确认任务未创建，可安全重试":"厂商任务记录不存在，已停止自动处理",error:status.error||"厂商查询接口返回任务不存在",providerJobId:status.providerJobId||task.providerJobId,recoveryState:"provider_not_found",safeToRetry:status.notSentVerified===true,notSentVerified:status.notSentVerified===true,terminalFailureVerified:status.notSentVerified!==true,failureCode:"MODEL_PROVIDER_TASK_NOT_FOUND",failureCategory:"provider_query",providerMessage:status.error||"厂商查询接口返回任务不存在",retryMode:status.notSentVerified?"retry_or_edit":""});}
      if(status.failed){this.clearModelRecovery(task.id);return this.report(task.id,{state:"failed",progress:0,statusText:"厂商明确返回生成失败",error:status.error||`厂商任务状态：${status.status||"failed"}`,providerJobId:status.providerJobId||task.providerJobId,recoveryState:"provider_failed",safeToRetry:true,notSentVerified:false,terminalFailureVerified:true,failureCode:"MODEL_PROVIDER_GENERATION_FAILED",failureCategory:"provider_generation",providerMessage:status.error||`厂商任务状态：${status.status||"failed"}`,retryMode:"retry_or_edit"});}
      if(status.pending){const waiting=await this.report(task.id,{state:"generating",progressMode:"indeterminate",progress:Math.max(45,Number(task.progress||0)),statusText:`厂商正在生成${status.status?`（${status.status}）`:""}，后台将继续查询`,providerJobId:status.providerJobId||task.providerJobId,recoveryState:"provider_processing",error:null});this.scheduleModelRecovery(task.id,10000);return waiting;}
      if((task.resultType||task.creationType)==="text"&&status.completed){const content=String(status.content||"");if(!content.trim())throw new Error("平台文本任务已完成，但没有返回文本内容");task=await this.report(task.id,{state:"verifying",progressMode:"determinate",progress:80,statusText:"模型文本已返回，正在写入项目素材",resultText:content,resultType:"text",providerJobId:status.providerJobId||task.providerJobId,recoveryState:"response_received",error:null});const root=this.dataRootProvider?.();if(!root)throw new Error("租户数据目录不可用");if(task.conversationId)this.tasks.updateConversation(task.conversationId,{content,versionLabel:`模型生成 · ${task.modelId}`});const directory=path.join(root,"downloads");fs.mkdirSync(directory,{recursive:true});const safeTitle=String(task.title||"模型文本结果").replace(/[<>:"/\\|?*\x00-\x1F]/g,"_").replace(/\s+/g," ").trim().slice(0,48)||"模型文本结果";const target=path.join(directory,`${safeTitle}-${task.id.slice(0,8)}.txt`);fs.writeFileSync(target,content,"utf8");const imported=this.tasks.importAssets({projectId:task.projectId,paths:[target],source:"model-gateway-generation"})[0];if(!imported)throw new Error("模型文本结果无法导入素材中心");const named=this.tasks.updateAsset?this.tasks.updateAsset(imported.id,generatedAssetMetadata(task,"text","model-gateway")):imported;const completed=this.tasks.completeTask(task.id,{resultAssetId:named.id,resultType:"text",resultUrls:[],providerJobId:status.providerJobId||task.providerJobId,evidence:{...(task.evidence||{}),tenantId:this.tenantId(),providerId:task.providerId,modelId:task.modelId,providerJobId:status.providerJobId||task.providerJobId,submittedAt:task.evidence?.submittedAt||new Date().toISOString(),responseType:"text",completedAt:new Date().toISOString()}});this.clearModelRecovery(task.id);this.emitLiveStatus(completed);return completed;}
      urls=status.urls||[];providerExpected=Math.max(providerExpected,Number(status.expectedResultCount||0));task=await this.report(task.id,{state:"downloading",progress:85,statusText:"厂商已生成成功，正在逐项回传结果",resultUrls:urls.filter(value=>!/^data:/i.test(String(value||""))),expectedResultCount:providerExpected||urls.length,resultType:task.resultType||task.creationType,providerJobId:status.providerJobId||task.providerJobId,recoveryState:"downloading",error:null});
    }
    if(!urls.length){const waiting=await this.report(task.id,{state:"verifying",progress:80,statusText:"厂商已响应，但仍在等待结果地址",recoveryState:"awaiting_result_url",safeToRetry:false,notSentVerified:false});this.scheduleModelRecovery(task.id,10000);return waiting;}
    const type=task.resultType||task.creationType||"image",items=this.buildResultItems(task,urls,type),expected=Math.max(providerExpected,Number(task.expectedResultCount||0),items.length);task=await this.report(task.id,{state:"downloading",progressMode:"determinate",progress:85,statusText:`厂商已生成成功，正在逐项回传（${Number(task.recoveredResultCount||0)}/${expected}）`,resultUrls:urls.filter(value=>!/^data:/i.test(String(value||""))),resultItems:items,resultAssetIds:items.filter(item=>item.status==="imported"&&item.assetId).map(item=>item.assetId),expectedResultCount:expected,recoveredResultCount:items.filter(item=>item.status==="imported"&&item.assetId).length,resultType:type,recoveryState:"downloading",error:null,safeToRetry:false,notSentVerified:false});
    await runWithConcurrency(items.filter(item=>item.status!=="imported"||!item.assetId),MODEL_RESULT_DOWNLOAD_CONCURRENCY,item=>this.importModelResultItem(task,item,expected));
    task=this.currentTask(task.id);const currentItems=Array.isArray(task.resultItems)?task.resultItems:[],required=currentItems.filter(item=>item.required!==false),imported=required.filter(item=>item.status==="imported"&&item.assetId),failed=required.filter(item=>item.status==="failed");
    if(expected!==required.length){this.clearModelRecovery(task.id);return this.report(task.id,{state:"paused",stage:"manual_review",progressMode:"paused",progress:Math.max(85,Math.min(95,85+Math.round(imported.length/Math.max(1,expected)*10))),statusText:`结果数量不一致：预期 ${expected} 项，已发现 ${required.length} 项`,error:`厂商完成状态返回 ${required.length} 个结果，但任务预期 ${expected} 个`,recoveryState:"result_review_required",recoveredResultCount:imported.length,userAction:"请补充或替换缺失的结果地址，然后仅恢复回传；不会重新调用生成接口。"});}
    if(failed.length){const maxAttempts=Math.max(...failed.map(item=>Number(item.attempts||0)));if(maxAttempts>=MODEL_RESULT_ITEM_MAX_ATTEMPTS){this.clearModelRecovery(task.id);return this.report(task.id,{state:"paused",stage:"manual_review",progressMode:"paused",progress:Math.max(85,Math.min(95,85+Math.round(imported.length/Math.max(1,expected)*10))),statusText:`${imported.length}/${expected} 项已入库，其余结果连续回传失败`,error:failed.map(item=>`第 ${item.index+1} 项：${item.lastError}`).join("；"),recoveryState:"result_review_required",recoveredResultCount:imported.length,userAction:"可修改失效地址、继续、仅重试未完成回传或取消本地追踪。"});}const waiting=await this.report(task.id,{state:"downloading",progress:Math.max(85,Math.min(95,85+Math.round(imported.length/Math.max(1,expected)*10))),statusText:`已回传 ${imported.length}/${expected} 项，失败项稍后自动恢复`,error:failed.map(item=>item.lastError).filter(Boolean).join("；"),recoveryState:"retrying",recoveredResultCount:imported.length});this.scheduleModelRecovery(task.id,5000);return waiting;}
    if(imported.length!==expected){const waiting=await this.report(task.id,{state:"downloading",progress:Math.max(85,Math.min(95,85+Math.round(imported.length/Math.max(1,expected)*10))),statusText:`已回传 ${imported.length}/${expected} 项，等待剩余结果`,recoveryState:"retrying",recoveredResultCount:imported.length});this.scheduleModelRecovery(task.id,5000);return waiting;}
    try{const resultAssetIds=imported.sort((a,b)=>a.index-b.index).map(item=>item.assetId);const completed=this.tasks.completeTask(task.id,{resultAssetId:resultAssetIds[0],resultAssetIds,resultItems:currentItems,expectedResultCount:expected,resultVid:type==="video"?required[0]?.url||"":"",resultType:type,resultUrls:required.map(item=>item.url).filter(value=>!/^data:/i.test(String(value||""))),providerJobId:task.providerJobId||"",evidence:{...(task.evidence||{}),tenantId:this.tenantId(),providerId:task.providerId,modelId:task.modelId,providerJobId:task.providerJobId||"",submittedAt:task.evidence?.submittedAt||new Date().toISOString(),responseType:type,completedAt:new Date().toISOString()}});this.clearModelRecovery(task.id);this.emitLiveStatus(completed);return completed;}
    catch(error){const waiting=await this.report(task.id,{state:"downloading",progress:95,statusText:`${imported.length}/${expected} 项已入库，正在恢复最终绑定`,error:String(error.message||error),recoveryState:"finalize_retrying",recoveredResultCount:imported.length});this.scheduleModelRecovery(task.id,5000);return waiting;}
  }
  async downloadModelResult(urlValue, taskId, type, index = 0, itemKey = "") {
    const url = String(urlValue || ""); const root = this.dataRootProvider?.(); if (!root) throw new Error("租户数据目录不可用");const directory = path.join(root, "downloads"); fs.mkdirSync(directory, {recursive:true});
    const ext = type === "video" ? ".mp4" : type === "audio" ? ".mp3" : ".png",suffix=String(itemKey||crypto.createHash("sha256").update(url).digest("hex")).slice(0,10),target = path.join(directory, `${taskId}-${Number(index)+1}-${suffix}${ext}`);let buffer;
    if (/^data:/i.test(url)) { const match = url.match(/^data:[^;]+;base64,(.+)$/i); if (!match) throw new Error("模型返回的数据地址无效"); buffer = Buffer.from(match[1], "base64"); }
    else { const parsed = new URL(url); if (!/^https?:$/.test(parsed.protocol)) throw new Error("模型结果地址仅支持 HTTP/HTTPS");let lastError=null;for(let attempt=1;attempt<=3;attempt++){try{const response=await this.fetchImpl(parsed,{headers:{Accept:"*/*"}});if(!response.ok)throw new Error(`HTTP ${response.status}`);buffer=Buffer.from(await response.arrayBuffer());if(buffer.length)break;throw new Error("结果文件为空");}catch(error){lastError=error;if(attempt<3)await new Promise(resolve=>setTimeout(resolve,250*attempt));}}if(!buffer?.length)throw new Error(`下载模型结果失败：${String(lastError?.message||lastError||"未知错误")}`); }
    if (!buffer.length) throw new Error("模型结果文件为空");const temporary=`${target}.${process.pid}.tmp`,checksum=crypto.createHash("sha256").update(buffer).digest("hex");fs.writeFileSync(temporary, buffer);fs.renameSync(temporary,target);return{path:target,bytes:buffer.length,checksum};
  }
  doubaoResultUrl(task,result={}) { return [result.videoUrl,result.resourceDescriptor?.url,result.resultUrls?.[0],task.resultUrls?.[0],task.resultVid].map(value=>String(value||"").trim()).find(value=>/^https?:\/\//i.test(value))||""; }
  async pauseDoubaoResultRecovery(taskId,error,result={}) {
    this.clearMonitor(taskId);const task=this.currentTask(taskId);if(!task)return null;const resultUrl=this.doubaoResultUrl(task,result),message=String(error?.message||error||result.videoError||"素材回传失败");
    const paused=await this.report(taskId,{state:"paused",stage:"manual_review",progressMode:"paused",progress:Math.max(85,Number(task.progress||0)),statusText:"豆包视频已生成，但素材回传失败，等待人工处理",conversationVid:result.conversationVid||result.conversationId||task.conversationVid||task.conversationId||"",videoVid:result.videoVid||result.resourceDescriptor?.videoVid||task.videoVid||"",resultType:"video",resultUrls:resultUrl?[resultUrl]:(task.resultUrls||[]),resultVid:resultUrl||task.resultVid||"",resultUrlSource:result.resultUrlSource||task.resultUrlSource||"",watermarkFree:typeof result.watermarkFree==="boolean"?result.watermarkFree:task.watermarkFree,watermarkFreeError:result.watermarkFreeError!==undefined?result.watermarkFreeError:(error?.watermarkFreeError!==undefined?error.watermarkFreeError:task.watermarkFreeError||""),resultSourceResolvedAt:result.resultSourceResolvedAt||task.resultSourceResolvedAt||"",fallbackResultVid:result.fallbackResultVid||task.fallbackResultVid||"",retryMode:"recover_result",recoveryState:"result_review_required",failureCode:String(error?.code||result.code||"DOUBAO_RESULT_RECOVERY_FAILED"),failureCategory:"result_download",providerMessage:message,userAction:"可点击“重新回传”凭已保存的视频 VID 重新解析源地址并导入已有视频，或取消本地回传；不会重新生成视频。",submittedVerified:true,accountAction:"release",safeToRetry:false,notSentVerified:false,error:message});
    this.releaseAccount(taskId);return paused;
  }
  async completeDoubaoResult(taskInput,result={}) {
    const task=this.currentTask(taskInput?.id)||taskInput;this.assertTaskNotCancelled(task.id);const resultUrl=this.doubaoResultUrl(task,result),resultPath=result.resultPath;
    await this.report(task.id,{state:"verifying",stage:"verifying",progressMode:"determinate",progress:92,statusText:result.watermarkFree===true?"豆包无水印源视频已下载，正在校验并写入项目素材":"豆包页面视频已下载，正在校验并写入项目素材",conversationVid:result.conversationVid||result.conversationId||task.conversationVid||task.conversationId||"",videoVid:result.videoVid||result.resourceDescriptor?.videoVid||task.videoVid||"",resultType:"video",resultUrls:resultUrl?[resultUrl]:(task.resultUrls||[]),resultVid:resultUrl||task.resultVid||"",resultUrlSource:result.resultUrlSource||task.resultUrlSource||"",watermarkFree:typeof result.watermarkFree==="boolean"?result.watermarkFree:task.watermarkFree,watermarkFreeError:result.watermarkFreeError!==undefined?result.watermarkFreeError:task.watermarkFreeError||"",resultSourceResolvedAt:result.resultSourceResolvedAt||task.resultSourceResolvedAt||"",fallbackResultVid:result.fallbackResultVid||task.fallbackResultVid||"",retryMode:"recover_result",recoveryState:"validating_result",error:null});
    this.assertTaskNotCancelled(task.id);if(!resultPath||!fs.existsSync(resultPath))throw Object.assign(new Error("豆包结果文件不存在"),{code:"DOUBAO_RESULT_FILE_MISSING"});
    const resultKey=`doubao-result:${task.id}:${crypto.createHash("sha256").update(resultUrl||resultPath).digest("hex").slice(0,24)}`,imported=this.tasks.importAssets?this.tasks.importAssets({projectId:task.projectId,paths:[resultPath],source:"doubao-generation",dedupeKey:resultKey})[0]:null;if(!imported)throw Object.assign(new Error("豆包结果无法回填素材"),{code:"DOUBAO_RESULT_IMPORT_FAILED"});
    this.assertTaskNotCancelled(task.id);const named=this.tasks.updateAsset?this.tasks.updateAsset(imported.id,generatedAssetMetadata(task,imported.type||"video","doubao")):imported;
    const conversationVid=result.conversationVid||result.conversationId||task.conversationVid||task.conversationId||"",videoVid=result.videoVid||result.resourceDescriptor?.videoVid||task.videoVid||"";const completed=this.tasks.completeTask(task.id,{resultAssetId:named.id,resultVid:resultUrl,conversationVid,videoVid,resultType:named.type||"video",resultUrls:resultUrl?[resultUrl]:[],resultUrlSource:result.resultUrlSource||task.resultUrlSource||"",watermarkFree:typeof result.watermarkFree==="boolean"?result.watermarkFree:task.watermarkFree,watermarkFreeError:result.watermarkFreeError!==undefined?result.watermarkFreeError:task.watermarkFreeError||"",resultSourceResolvedAt:result.resultSourceResolvedAt||task.resultSourceResolvedAt||"",fallbackResultVid:result.fallbackResultVid||task.fallbackResultVid||"",evidence:{...(task.evidence||{}),...(result.submittedEvidence||{}),tenantId:this.tenantId(),accountId:task.accountId,conversationId:result.conversationId||task.conversationId||"",conversationVid,videoVid,submittedAt:task.evidence?.submittedAt||result.submittedEvidence?.submittedAt||new Date().toISOString(),completedAt:new Date().toISOString(),resultRecoveredWithoutGeneration:true}});this.clearMonitor(task.id);this.syncBrowserTask(completed);this.emitLiveStatus(completed);this.releaseAccount(task.id);return completed;
  }
  recoverDoubaoResult(taskInput) {
    const taskId=String(taskInput?.id||"");if(this.doubaoResultRuns.has(taskId))return this.doubaoResultRuns.get(taskId);const promise=this._recoverDoubaoResult(taskInput).finally(()=>this.doubaoResultRuns.delete(taskId));this.doubaoResultRuns.set(taskId,promise);return promise;
  }
  async _recoverDoubaoResult(taskInput) {
    let task=this.currentTask(taskInput?.id)||taskInput;if(!task)throw new Error("待恢复的豆包任务不存在");const resultUrl=this.doubaoResultUrl(task,taskInput),videoVid=String(task.videoVid||taskInput?.videoVid||"").trim();if(!resultUrl&&!videoVid)throw new Error("缺少可重新回传的豆包视频 VID 或地址");
    try{
      const account=this.assertAuthorizedAccount({id:task.accountId,name:task.accountName});task={...task,accountId:account.id,accountName:account.name};
      this.assertTaskNotCancelled(task.id);task=await this.report(task.id,{state:"downloading",stage:"downloading",progressMode:"determinate",progress:85,statusText:"正在凭视频 VID 重新解析并回传豆包视频，不会重新生成",resultType:"video",resultUrls:resultUrl?[resultUrl]:(task.resultUrls||[]),resultVid:resultUrl||task.resultVid||"",retryMode:"recover_result",recoveryState:"manual_retry",submittedVerified:true,accountAction:"release",safeToRetry:false,notSentVerified:false,error:null});
      const result=await this.executeBrowserTask(task,"recover_result",{action:"recover_result",account,payload:{jobId:task.id,resultUrl,resultUrls:resultUrl?[resultUrl]:[],fallbackResultVid:task.fallbackResultVid||resultUrl,resourceDescriptor:taskInput?.resourceDescriptor||null,conversationId:task.conversationId||"",conversationVid:task.conversationVid||task.conversationId||"",videoVid}},{submissionUnknown:false});
      this.assertTaskNotCancelled(task.id);if(!result?.ok||result.state!=="completed")throw Object.assign(new Error(result?.message||result?.videoError||"豆包素材回传失败"),{code:result?.code||"DOUBAO_RESULT_RECOVERY_FAILED"});return await this.completeDoubaoResult(task,result);
    }catch(error){if(error?.code==="TASK_CANCELLED")return this.currentTask(task.id);return this.pauseDoubaoResultRecovery(task.id,error,{...taskInput,videoUrl:resultUrl});}
  }
  async runDoubao(task, action = "generate") {
    this.authorize(["monitor","recover_result","validate_submission_context","resume"].includes(action)?"result-recovery":"generate");
    this.assertTaskNotCancelled(task.id);
    const authorizedAccount=this.assertAuthorizedAccount({id:task.accountId,name:task.accountName});task={...task,accountId:authorizedAccount.id,accountName:authorizedAccount.name};
    if(action==="monitor")this.syncBrowserTask(task);else await this.beginBrowserTask(task);
    await this.liveViewProvider?.({taskId:task.id,title:task.title,executionChannel:"doubao",accountId:task.accountId,accountName:task.accountName,state:task.state,statusText:task.statusText});
    if (action === "generate") { const checkpointAt=new Date().toISOString();this.assertTaskNotCancelled(task.id);task=await this.report(task.id, {state:"checking_login",stage:"checking_login",progressMode:"determinate",progress:10,statusText:`正在检查豆包账号并配置 ${task.doubaoModel} · ${task.ratio} · ${task.duration}`,lastHeartbeatAt:checkpointAt,executionCheckpoint:{phase:"checking_login",action:"validate_account",irreversible:false,startedAt:task.executionCheckpoint?.startedAt||checkpointAt,updatedAt:checkpointAt}}); }
    else { const heartbeatAt=new Date().toISOString();task=await this.report(task.id, {state:"generating",stage:"monitoring",progressMode:"indeterminate",progress:Math.max(45,Number(task.progress||0)),lastCheckedAt:heartbeatAt,lastHeartbeatAt:heartbeatAt,statusText:"正在恢复对应豆包会话并检查生成结果",executionCheckpoint:{phase:"monitoring",action:"monitor_existing_submission",irreversible:true,startedAt:task.executionCheckpoint?.startedAt||heartbeatAt,updatedAt:heartbeatAt,submissionStartedAt:task.executionCheckpoint?.submissionStartedAt||task.evidence?.submittedAt||null,submissionConfirmedAt:task.executionCheckpoint?.submissionConfirmedAt||task.evidence?.submittedAt||null},appendStep:false}); }
    const imageAssets=this.resolveTaskReferenceAssets(task);
    if(action==="generate"&&imageAssets.length){const uploadAt=new Date().toISOString();task=await this.report(task.id,{state:"uploading",stage:"uploading_references",progressMode:"determinate",progress:18,statusText:`正在按图号向豆包上传 ${imageAssets.length} 张参考图`,lastHeartbeatAt:uploadAt,executionCheckpoint:{phase:"uploading_references",action:"prepare_reference_upload",irreversible:false,startedAt:task.executionCheckpoint?.startedAt||uploadAt,updatedAt:uploadAt}});}
    if(action!=="monitor"){const submissionStartedAt=new Date().toISOString();task=await this.report(task.id,{state:"configuring",stage:"browser_automation",progressMode:"indeterminate",progress:Math.max(22,Number(task.progress||0)),statusText:"正在豆包页面配置参数并提交，期间请勿关闭账号窗口",lastHeartbeatAt:submissionStartedAt,executionCheckpoint:{phase:"browser_automation_started",action:action==="resume"?"resume_and_submit":"configure_and_submit",irreversible:true,startedAt:task.executionCheckpoint?.startedAt||submissionStartedAt,updatedAt:submissionStartedAt,submissionStartedAt},appendStep:false});}
    const result = await this.executeBrowserTask(task,action,{action, account: {id: task.accountId, name: task.accountName, platform: "豆包"}, payload: {jobId: task.id, prompt: task.evidence?.sourcePrompt||task.prompt, conversationId:task.conversationId||task.evidence?.conversationId||"",conversationVid:task.conversationVid||task.conversationId||task.evidence?.conversationId||"",videoVid:task.videoVid||"",userMessageId:task.evidence?.userMessageId||"",requestId:task.evidence?.requestId||"",submittedAt:task.evidence?.submittedAt||"", doubaoModel:task.doubaoModel,ratio: task.ratio, duration: task.duration, imageAssetIds: task.assetIds,imageAssets,creationType:task.creationType}},{submissionUnknown:action!=="recover_result"});
    if (result.loginRequired) {
      await this.waitForDoubaoAuthentication(task,authorizedAccount,result,{preSubmission:action==="generate"});
      return result;
    }
    if (result.verificationRequired || result.paused) {
      const preSubmission=action==="generate"&&result.notSentVerified===true;
      await this.waitForDoubaoAuthentication({...task,conversationId:result.conversationId||task.conversationId||""},authorizedAccount,result,{preSubmission});
      return result;
    }
    if (!result.ok) { const error=new Error(result.message||"豆包执行失败");for(const key of ["outcomeCode","terminal","submittedVerified","accountAction","evidence","code","category","retryMode","requiresPromptEdit","userAction","providerMessage","quotaConsumed","providerTerminal","terminalFailureVerified","safeToRetry","notSentVerified","quotaExhausted"])if(result[key]!==undefined)error[key]=result[key];error.code=error.code||"DOUBAO_EXECUTION_FAILED";throw error; }
    const recoveringDownload = result.state === "downloading" || result.resultDownloadFailed === true || result.code === "DOUBAO_RESULT_DOWNLOAD_FAILED";
    const submissionVerified = result.submittedVerified === true || Boolean(result.submittedEvidence?.conversationId || result.monitorProbe?.conversationMatches || result.monitorProbe?.promptPresentInCurrentConversation || task.evidence?.conversationId || task.submittedVerified === true);
    const resultAt=new Date().toISOString(),conversationVid=result.conversationVid||result.conversationId||task.conversationVid||task.conversationId||"",videoVid=result.videoVid||result.resourceDescriptor?.videoVid||task.videoVid||"";await this.report(task.id, {state: result.state === "completed" ? "verifying" : recoveringDownload ? "downloading" : "generating",stage:result.state === "completed"?"result_detected":recoveringDownload?"recovering_result":"generating",progressMode:result.state === "completed"?"determinate":"indeterminate", progress: result.state === "completed" ? 80 : recoveringDownload ? 85 : 45,monitorAttempt:result.state === "completed"?task.monitorAttempt||0:0,lastCheckedAt:resultAt,lastHeartbeatAt:resultAt,executionCheckpoint:{phase:result.state==="completed"?"result_detected":recoveringDownload?"recovering_result":"monitoring",action:result.state==="completed"?"verify_result":recoveringDownload?"recover_download":"monitor_existing_submission",irreversible:true,startedAt:task.executionCheckpoint?.startedAt||resultAt,updatedAt:resultAt,submissionStartedAt:task.executionCheckpoint?.submissionStartedAt||result.submittedEvidence?.submittedAt||resultAt,submissionConfirmedAt:submissionVerified?resultAt:(task.executionCheckpoint?.submissionConfirmedAt||null)}, statusText: result.message || (recoveringDownload ? "结果已生成，正在仅恢复下载" : "豆包已确认提交，正在生成"), accountId: task.accountId, accountName: task.accountName, conversationId: result.conversationId || task.conversationId || "",conversationVid,videoVid,resultUrls:Array.isArray(result.resultUrls)?result.resultUrls:(result.videoUrl?[result.videoUrl]:task.resultUrls||[]),resultVid:result.videoUrl||task.resultVid||"",resultUrlSource:result.resultUrlSource||task.resultUrlSource||"",watermarkFree:typeof result.watermarkFree==="boolean"?result.watermarkFree:task.watermarkFree,watermarkFreeError:result.watermarkFreeError!==undefined?result.watermarkFreeError:task.watermarkFreeError||"",resultSourceResolvedAt:result.resultSourceResolvedAt||task.resultSourceResolvedAt||"",fallbackResultVid:result.fallbackResultVid||task.fallbackResultVid||"",failureCode:result.code||task.failureCode||"",failureCategory:result.category||task.failureCategory||"",retryMode:result.retryMode|| (recoveringDownload?"recover_result":task.retryMode||""),recoveryState:recoveringDownload?"result_download_failed":result.recoveryState||"",accountAction:recoveringDownload?"hold":task.accountAction||"",submittedVerified:submissionVerified,error:recoveringDownload?result.videoError||null:null,monitorError:recoveringDownload?"":result.videoPending?String(result.videoError||""):"",monitorProbe:result.monitorProbe||task.monitorProbe||null,appendStep:action!=="monitor"||recoveringDownload, evidence: result.submittedEvidence ? {...result.submittedEvidence, tenantId: this.tenantId(), accountId: task.accountId, conversationVid,videoVid, submittedAt: resultAt} : (task.evidence || null)});
    if (result.state !== "completed") { if(recoveringDownload)return this.pauseDoubaoResultRecovery(task.id,new Error(result.videoError||result.message||"豆包素材回传失败"),result);this.scheduleMonitor(task.id);return result; }
    try{return await this.completeDoubaoResult(task,result);}catch(error){return this.pauseDoubaoResultRecovery(task.id,error,result);}
  }
  async pauseModel(taskId) { this.authorize("result-recovery");const task=this.currentTask(taskId);if(!task)throw new Error("任务不存在");if(task.executionChannel!=="model-gateway")throw new Error("只有模型网关任务支持暂停");if(["completed","failed","cancelled","paused"].includes(task.state))return task;if(["preparing","submitting"].includes(task.state))throw new Error("请求正在提交，暂不能暂停；可等待厂商任务标识返回后暂停追踪");this.clearModelRecovery(taskId);return this.report(taskId,{state:"paused",stage:"manual_review",progressMode:"paused",statusText:"已暂停模型任务查询和结果回传",recoveryState:"manual_paused",safeToRetry:false,notSentVerified:false,userAction:"继续后将从已保存的结果检查点恢复，不会重新提交生成请求。"}); }
  async resumeModel(taskId) { const task=this.currentTask(taskId);if(!task)throw new Error("任务不存在");if(task.executionChannel!=="model-gateway")throw new Error("只有模型网关任务支持继续");if(task.state!=="paused")throw new Error("当前模型任务未暂停");this.modelRecoveryAttempts.delete(taskId);const hasResults=(task.resultItems||[]).length||(task.resultUrls||[]).length;const resumed=await this.report(taskId,{state:hasResults?"downloading":"generating",stage:hasResults?"downloading":"generating",progressMode:hasResults?"determinate":"indeterminate",statusText:hasResults?"正在从结果检查点继续回传":"正在继续查询原厂商任务",recoveryState:hasResults?"manual_resumed":"provider_processing",error:null});return this.recoverModelResult(resumed); }
  async retryModelResult(taskId) { const task=this.currentTask(taskId);if(!task)throw new Error("任务不存在");if(task.executionChannel!=="model-gateway")throw new Error("只有模型网关任务支持重试回传");if(!["paused","downloading","verifying","submission_unknown","failed"].includes(task.state))throw new Error("当前状态不支持重试回传");if(!(task.resultItems||[]).length&&!(task.resultUrls||[]).length&&!task.providerJobId&&!task.clientRequestId)throw new Error("缺少可恢复的结果地址或厂商任务标识");this.clearModelRecovery(taskId);this.modelRecoveryAttempts.delete(taskId);const resetItems=(task.resultItems||[]).map(item=>item.status==="failed"?{...item,status:"pending",attempts:0,lastError:""}:item),retrying=await this.report(taskId,{state:(resetItems.length||(task.resultUrls||[]).length)?"downloading":"generating",progressMode:(resetItems.length||(task.resultUrls||[]).length)?"determinate":"indeterminate",statusText:"正在仅重试结果回传，不会重新调用生成接口",resultItems:resetItems,recoveryState:"manual_retry",error:null,safeToRetry:false,notSentVerified:false});return this.recoverModelResult(retrying); }
  async retryDoubaoResult(taskId) { const task=this.currentTask(taskId);if(!task)throw new Error("任务不存在");if(task.executionChannel!=="doubao")throw new Error("只有豆包任务支持重新回传");this.clearMonitor(taskId);const prepared=this.tasks.prepareDoubaoResultRecovery(taskId,{resultUrls:task.resultUrls,resultUrl:task.resultVid,fallbackResultVid:task.fallbackResultVid,videoVid:task.videoVid,source:"human-review"});return this.recoverDoubaoResult(prepared); }
  async retryTask(taskId,input={}) { this.authorize("generate");const original=this.currentTask(taskId);if(!original)throw new Error("任务不存在");const executionPatch=original.executionChannel==="doubao"?this.secureDoubaoRetryAccounts(original):{};const task=this.tasks.retryTask(taskId,input,executionPatch);this.run(task.id).catch(()=>{});return task; }
  async updateModelResult(taskId,input={}) { const task=this.currentTask(taskId);if(!task)throw new Error("任务不存在");if(task.executionChannel!=="model-gateway")throw new Error("只有模型网关任务支持人工补充结果");this.clearModelRecovery(taskId);this.modelRecoveryAttempts.delete(taskId);const prepared=this.tasks.prepareModelResultRecovery(taskId,{...input,source:input.source||"human-review"});return this.recoverModelResult(prepared); }
  async resume(taskId) { const task = this.tasks.bootstrap().tasks.find(item => item.id === taskId); if (!task) throw new Error("任务不存在"); if (task.executionChannel !== "doubao") throw new Error("只有豆包登录或人工验证任务支持继续"); if (!["awaiting_verification","awaiting_login"].includes(task.state)) throw new Error("当前任务不处于等待登录或人工验证状态");const preSubmission=["pre_submit_login_required","pre_submit_verification_required"].includes(task.recoveryState)&&task.submittedVerified!==true&&!task.evidence?.submittedAt;this.authorize(preSubmission?"generate":"result-recovery"); await this.acquireAccount(task);try{return await this.runDoubao(task,preSubmission?"generate":"resume");}catch(error){if(error?.terminalFailureVerified===true)return this.handleProviderTerminalFailure(taskId,error);this.clearMonitor(taskId);const failed=await this.report(taskId,{state:"failed",progress:0,statusText:"人工处理后继续执行失败",error:String(error.message||error),safeToRetry:false,notSentVerified:false});this.releaseAccount(taskId);throw Object.assign(error,{task:failed});} }
  async monitor(taskId) { this.authorize("result-recovery");const task = this.tasks.bootstrap().tasks.find(item => item.id === taskId); if (!task) throw new Error("任务不存在"); if (task.executionChannel !== "doubao") throw new Error("只有豆包任务支持结果监控"); if (!["generating", "downloading", "submission_unknown"].includes(task.state)) throw new Error("当前任务不处于可监控状态"); await this.acquireAccount(task);try{const result=await this.runDoubao(task, "monitor");const latest=this.tasks.bootstrap().tasks.find(item=>item.id===taskId);if(latest?.state==="generating"||latest?.state==="downloading")this.scheduleMonitor(taskId);return result;}catch(error){if(error?.quotaExhausted===true&&error?.notSentVerified===true)return this.handleMonitorQuotaExhausted(taskId,task,error);if(error?.terminalFailureVerified===true)return this.handleProviderTerminalFailure(taskId,error);if(error?.code==="DOUBAO_CONVERSATION_RESTORE_FAILED")return this.protectMonitorSubmissionUnknown(taskId,error,task.monitorAttempt||0);if(error?.code==="DOUBAO_EXECUTION_TIMEOUT")return this.protectExecutionTimeout(taskId,error,task);this.clearMonitor(taskId);const failed=await this.report(taskId,{state:"failed",progress:0,statusText:"监控或切号执行失败",error:String(error.message||error),safeToRetry:false,notSentVerified:false});this.releaseAccount(taskId);throw Object.assign(error,{task:failed});} }
  async validateSubmissionContext(taskInput) {
    const task=this.currentTask(taskInput?.id)||taskInput;if(!task)throw new Error("任务不存在");
    const account=this.assertAuthorizedAccount({id:task.accountId,name:task.accountName});
    const result=await this.executeBrowserTask(task,"validate_submission_context",{action:"validate_submission_context",account,payload:{jobId:task.id,prompt:task.evidence?.sourcePrompt||task.prompt,conversationId:task.conversationId||task.evidence?.conversationId||"",userMessageId:task.evidence?.userMessageId||"",submittedAt:task.evidence?.submittedAt||""}},{submissionUnknown:false});
    if(!result?.ok||result.matched!==true){
      const message=String(result?.message||"当前豆包会话没有匹配到该任务提示词，请先打开包含该提示词的正确会话");
      const protectedTask=await this.report(task.id,{state:"submission_unknown",stage:"manual_review",progressMode:"paused",progress:Math.max(15,Number(task.progress||0)),statusText:"当前豆包会话与任务提示词不匹配，请先打开正确会话",error:message,monitorError:message,monitorProbe:result?.monitorProbe||null,safeToRetry:false,notSentVerified:false,accountAction:"hold",recoveryState:"submission_context_mismatch",failureCode:String(result?.code||"DOUBAO_SUBMISSION_CONTEXT_MISMATCH"),failureCategory:String(result?.category||"monitor_binding"),providerMessage:message,userAction:"请在该账号的豆包窗口中打开包含本任务提示词的原会话，再重新校验。"});
      this.holdAccount(protectedTask);
      throw Object.assign(new Error(message),{code:result?.code||"DOUBAO_SUBMISSION_CONTEXT_MISMATCH",category:result?.category||"monitor_binding",task:protectedTask,monitorProbe:result?.monitorProbe||null});
    }
    const validatedAt=new Date().toISOString(),conversationId=String(result.conversationId||task.conversationId||task.evidence?.conversationId||""),userMessageId=String(result.userMessageId||task.evidence?.userMessageId||"");
    const validated=await this.report(task.id,{state:"submission_unknown",stage:"manual_review",progressMode:"paused",statusText:"当前会话与提示词匹配成功，正在继续监控",conversationId,submittedVerified:true,accountAction:"hold",recoveryState:"submission_context_validated",failureCode:"",failureCategory:"",safeToRetry:false,notSentVerified:false,error:null,monitorError:"",monitorProbe:result.monitorProbe||null,userAction:"继续监控原账号和已校验会话",evidence:{...(task.evidence||{}),tenantId:this.tenantId(),accountId:task.accountId||"",conversationId,userMessageId,contextValidatedAt:validatedAt,contextValidation:"prompt-and-conversation-matched"}});
    this.holdAccount(validated);return validated;
  }
  async resolveSubmissionUnknown(taskId, resolution) {
    const task=this.currentTask(taskId);if(!task)throw new Error("任务不存在");
    if(task.executionChannel!=="doubao")throw new Error("当前人工核对入口仅支持豆包任务");
    if(task.state!=="submission_unknown")throw new Error("当前任务不处于提交状态未知");
    const choice=String(resolution||"");
    if(choice==="submitted"){
      this.clearUnknownAudit(taskId);
      await this.validateSubmissionContext(task);
      return this.monitor(taskId);
    }
    if(choice==="failed"){
      this.clearUnknownAudit(taskId);this.clearMonitor(taskId);
      const reviewedAt=new Date().toISOString();
      const resolved=await this.report(taskId,{state:"failed",stage:"failed",progressMode:"determinate",progress:0,statusText:"人工核对确认豆包已结束且生成失败",error:"人工在原豆包会话确认本次视频生成失败",safeToRetry:true,notSentVerified:false,terminalFailureVerified:true,submittedVerified:true,accountAction:"release",retryMode:"retry_or_edit",requiresPromptEdit:false,outcomeCode:"HUMAN_CONFIRMED_PROVIDER_FAILURE",failureCode:"HUMAN_CONFIRMED_PROVIDER_FAILURE",failureCategory:"provider_terminal_unknown",providerMessage:"人工核对确认豆包页面已明确显示生成失败",userAction:"可检查提示词、素材和参数后创建新的子任务重试；原失败任务和证据将保留。",quotaConsumed:null,recoveryState:"human_confirmed_provider_failure",failureEvidence:{source:"human-review",tenantId:this.tenantId(),accountId:task.accountId||"",conversationId:task.conversationId||"",reviewedAt,resolution:"failed"}});
      this.releaseAccount(taskId);return resolved;
    }
    if(choice==="not_submitted"){
      this.clearUnknownAudit(taskId);this.clearMonitor(taskId);
      const reviewedAt=new Date().toISOString();
      const resolved=await this.report(taskId,{state:"failed",stage:"failed",progressMode:"determinate",progress:0,statusText:"人工核对确认未提交，已结束保护；如需生成请手动创建安全重试",error:"人工在原豆包会话确认本次提示词未提交",safeToRetry:true,notSentVerified:true,terminalFailureVerified:false,submittedVerified:false,accountAction:"release",retryMode:"retry_or_edit",requiresPromptEdit:false,outcomeCode:"HUMAN_CONFIRMED_NOT_SUBMITTED",failureCode:"HUMAN_CONFIRMED_NOT_SUBMITTED",failureCategory:"submission_unknown_resolution",providerMessage:"人工核对确认原会话没有本次提交",userAction:"可使用安全重试创建新任务；系统不会自动重提",quotaConsumed:false,recoveryState:"human_confirmed_not_submitted",failureEvidence:{source:"human-review",tenantId:this.tenantId(),accountId:task.accountId||"",conversationId:task.conversationId||"",reviewedAt,resolution:"not_submitted"}});
      this.releaseAccount(taskId);return resolved;
    }
    throw new Error("请选择有效的人工核对结论");
  }
  async cancel(taskId) { const task = this.tasks.bootstrap().tasks.find(item => item.id === taskId); if (!task) throw new Error("任务不存在");this.cancelledTasks.add(taskId);this.clearMonitor(taskId);this.clearUnknownAudit(taskId);this.clearQuotaTimer(taskId);this.clearAccountAvailabilityTimer(taskId);this.clearModelRecovery(taskId);let result;if(task.executionChannel==="model-gateway"){const submitted=Boolean(task.providerJobId||task.clientRequestId||!["draft","queued","preparing"].includes(task.state));let remote={supported:false,cancelled:false};if(submitted&&typeof this.modelGateway.cancelGeneration==="function")try{remote=await this.modelGateway.cancelGeneration(task.providerId,task.modelId,{providerJobId:task.providerJobId,clientRequestId:task.clientRequestId,type:task.resultType||task.creationType});}catch(error){remote={supported:true,cancelled:false,error:String(error.message||error)};}const statusText=remote.cancelled?"厂商任务已取消，本地追踪已停止":submitted?"已停止本地追踪；厂商可能仍会继续执行并计费":"用户已取消模型任务";result=this.tasks.cancelTask(taskId,{force:submitted,statusText,recoveryState:remote.cancelled?"provider_cancelled":"local_tracking_cancelled",providerMessage:remote.cancelled?"厂商取消接口已确认成功":remote.error||"当前厂商未提供可用的远程取消接口",userAction:remote.cancelled?"无需后续操作":"如需确认是否仍在执行，请到厂商后台核对任务和计费记录。"});}else if((task.resultUrls||[]).length&&["downloading","verifying","paused"].includes(task.state)){result=this.tasks.cancelTask(taskId,{force:true,statusText:"已取消本地素材回传；豆包已生成的视频不会被删除",recoveryState:"local_result_recovery_cancelled",providerMessage:"仅停止客户端的下载、校验和素材导入",userAction:"如仍需要该视频，可从豆包原会话手动下载。"});}else result=this.tasks.cancelTask(taskId);this.syncBrowserTask(result);this.emitLiveStatus(result);this.releaseAccount(taskId);return result; }
}

module.exports = {GenerationOrchestrator, generatedAssetMetadata};
