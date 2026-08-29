"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {WorkbenchDataBridge,shanghaiDateKey,nextShanghaiMidnight}=require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator}=require("../src/main/generation-orchestrator.cjs");
const {BrowserController,normalizeVideoParameters,detectQuotaMessage,DOUBAO_VIDEO_MODELS,DOUBAO_VIDEO_RATIOS}=require("../src/main/browser-controller.cjs");
const truth=JSON.parse(fs.readFileSync(path.join(__dirname,"../references/doubao-quota-scheduler-ground-truth.json"),"utf8"));
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-quota-scheduler-"));
const tenantRoot=path.join(tempRoot,truth.tenantId);
const tasks=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const project=tasks.bootstrap().projects[0];
const checks=[];
const check=async(name,fn)=>{try{await fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:String(error.stack||error)})}};

(async()=>{
  await check("北京时间日期和零点恢复时间正确",()=>{
    const at=new Date(truth.shanghaiSampleAt);
    assert.equal(shanghaiDateKey(at),truth.expectedDateKey);
    assert.equal(nextShanghaiMidnight(at),truth.expectedNextResetAt);
  });
  await check("豆包模型、比例和时长使用真实范围",()=>{
    assert.deepStrictEqual([...DOUBAO_VIDEO_MODELS],truth.models);
    assert.deepStrictEqual([...DOUBAO_VIDEO_RATIOS],truth.ratios);
    assert.deepStrictEqual(normalizeVideoParameters({doubaoModel:"Seedance 2.0 Fast",ratio:"21:9",duration:"15s"}),{model:"Seedance 2.0 Fast",ratio:"21:9",duration:15});
    assert.deepStrictEqual(normalizeVideoParameters({doubaoModel:"未知模型",ratio:"2:1",duration:"99s"}),{model:"Seedance 2.0 Mini",ratio:"自动",duration:truth.durationMax});
    assert.equal(normalizeVideoParameters({duration:"1s"}).duration,truth.durationMin);
  });
  await check("只有明确视频额度提示被识别为额度熔断",()=>{
    assert.match(detectQuotaMessage(truth.quotaMessage),/视频额度/);
    assert.equal(detectQuotaMessage(truth.nonQuotaMessage),"");
  });
  await check("额度熔断按账号和模型持久化并在零点后自动失效",()=>{
    const block=tasks.markDoubaoQuotaExhausted(truth.accounts[0],{model:truth.models[1],at:truth.shanghaiSampleAt,reason:truth.quotaMessage});
    assert.equal(block.resetAt,truth.expectedNextResetAt);
    assert.equal(block.model,truth.models[1]);
    assert(tasks.doubaoQuotaBlock(truth.accounts[0].id,truth.models[1],new Date("2026-08-15T15:59:59.000Z")));
    assert.equal(tasks.doubaoQuotaBlock(truth.accounts[0].id,truth.models[0],new Date("2026-08-15T15:59:59.000Z")),null);
    assert.equal(tasks.doubaoQuotaBlock(truth.accounts[0].id,truth.models[1],new Date("2026-08-15T16:00:01.000Z")),null);
  });
  await check("自动调度遇到明确额度不足会安全切换下一个账号",async()=>{
    const calls=[];
    const browser={execute:async command=>{calls.push(command.account.id);if(command.account.id===truth.accounts[0].id)return{ok:false,quotaExhausted:true,notSentVerified:true,code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",message:truth.quotaMessage};return{ok:true,generating:true,conversationId:"123456789",submittedEvidence:{prompt:command.payload.prompt,conversationId:"123456789"},message:"正在生成"}}};
    const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>truth.tenantId,tasks,modelGateway:{},agentBridge:{browser},dataRootProvider:()=>tenantRoot});orchestrator.beginBrowserTask=async()=>{};
    const task=tasks.createTask({projectId:project.id,title:"自动换号",prompt:"生成一个测试视频",executionChannel:"doubao",state:"queued",accountSelectionMode:"auto",accountId:truth.accounts[0].id,accountName:truth.accounts[0].name,accountCandidates:truth.accounts,doubaoModel:"Seedance 2.0 Mini",ratio:"9:16",duration:"10s"});
    await orchestrator.run(task.id);const current=tasks.bootstrap().tasks.find(item=>item.id===task.id);
    assert.deepStrictEqual(calls,truth.accounts.map(item=>item.id));assert.equal(current.accountId,truth.accounts[1].id);assert.equal(current.state,"generating");assert.equal(current.quotaFailures.length,1);assert(tasks.doubaoQuotaBlock(truth.accounts[0].id,truth.models[1]));assert.equal(current.doubaoModel,"Seedance 2.0 Mini");assert.equal(current.ratio,"9:16");assert.equal(current.duration,"10s");
  });
  await check("监控阶段发现额度耗尽会停止当前账号并自动换号",async()=>{
    const calls=[];const browser={execute:async command=>{calls.push(`${command.account.id}:${command.action}`);if(command.action==="monitor")return{ok:false,quotaExhausted:true,notSentVerified:true,code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",message:truth.monitorQuotaMessage};return{ok:true,generating:true,conversationId:"next-account-conversation",submittedEvidence:{prompt:command.payload.prompt,conversationId:"next-account-conversation"},message:"正在生成"};}};
    const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>truth.tenantId,tasks,modelGateway:{},agentBridge:{browser},dataRootProvider:()=>tenantRoot});orchestrator.beginBrowserTask=async()=>{};
    const task=tasks.createTask({projectId:project.id,title:"监控换号",prompt:"生成一个会飞的气球",executionChannel:"doubao",state:"generating",progress:45,accountSelectionMode:"auto",accountId:truth.accounts[0].id,accountName:truth.accounts[0].name,accountCandidates:truth.accounts,doubaoModel:truth.models[0],ratio:"16:9",duration:"10s",conversationId:"old-conversation",evidence:{prompt:"生成一个会飞的气球",conversationId:"old-conversation",submittedAt:new Date().toISOString()}});
    await orchestrator.monitor(task.id);const current=tasks.bootstrap().tasks.find(item=>item.id===task.id);orchestrator.clearMonitor(task.id);
    assert.deepStrictEqual(calls,[`${truth.accounts[0].id}:monitor`,`${truth.accounts[1].id}:generate`]);assert.equal(current.accountId,truth.accounts[1].id);assert.equal(current.state,"generating");assert.equal(current.conversationId,"next-account-conversation");assert.equal(current.quotaFailures.at(-1).detectedDuring,"monitor");assert(tasks.doubaoQuotaBlock(truth.accounts[0].id,truth.models[0]));
  });
  await check("指定账号在监控阶段额度耗尽时停止并等待零点恢复",async()=>{
    const browser={execute:async()=>({ok:false,quotaExhausted:true,notSentVerified:true,code:"DOUBAO_VIDEO_QUOTA_EXHAUSTED",message:truth.monitorQuotaMessage})};const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>truth.tenantId,tasks,modelGateway:{},agentBridge:{browser},dataRootProvider:()=>tenantRoot});orchestrator.beginBrowserTask=async()=>{};
    const task=tasks.createTask({projectId:project.id,title:"指定账号额度终态",prompt:"生成视频",executionChannel:"doubao",state:"generating",accountSelectionMode:"manual",accountId:"manual-account",accountName:"指定账号",accountCandidates:[{id:"manual-account",name:"指定账号"}],doubaoModel:truth.models[1],conversationId:"manual-conversation",evidence:{prompt:"生成视频",conversationId:"manual-conversation",submittedAt:new Date().toISOString()}});
    await orchestrator.monitor(task.id);const current=tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"awaiting_quota");assert.equal(current.conversationId,"");assert(current.quotaResetAt);orchestrator.clearQuotaTimer(task.id);
  });
  await check("所有候选账号额度耗尽时进入等待零点恢复",async()=>{
    for(const account of truth.accounts)tasks.markDoubaoQuotaExhausted(account,{model:truth.models[1],reason:truth.quotaMessage});
    const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>truth.tenantId,tasks,modelGateway:{},agentBridge:{browser:{execute:async()=>{throw new Error("不应执行")}}},dataRootProvider:()=>tenantRoot});orchestrator.beginBrowserTask=async()=>{};
    const task=tasks.createTask({projectId:project.id,title:"等待额度",prompt:"生成视频",executionChannel:"doubao",state:"queued",accountSelectionMode:"auto",accountId:truth.accounts[0].id,accountName:truth.accounts[0].name,accountCandidates:truth.accounts});
    await orchestrator.run(task.id);const current=tasks.bootstrap().tasks.find(item=>item.id===task.id);assert.equal(current.state,"awaiting_quota");assert(current.quotaResetAt);orchestrator.clearQuotaTimer(task.id);
  });
  await check("取消后的终态不能被异步流程写回运行中",()=>{
    const task=tasks.createTask({projectId:project.id,title:"取消保护",prompt:"x",state:"queued"});tasks.cancelTask(task.id);const current=tasks.reportTask(task.id,{state:"checking_login",statusText:"错误回写"});assert.equal(current.state,"cancelled");assert.equal(current.statusText,"用户已取消任务");
  });
  await check("进入提交链路后不再提供伪取消",()=>{
    const task=tasks.createTask({projectId:project.id,title:"提交后取消",prompt:"x",executionChannel:"doubao",accountId:"account-x",state:"checking_login"});assert.throws(()=>tasks.cancelTask(task.id),/无法取消豆包服务器上的任务/);
  });
  await check("浏览器测试模式返回可安全换号的额度证据",async()=>{
    const controller=new BrowserController({profileRootProvider:()=>tempRoot,downloadRootProvider:()=>tempRoot,testMode:true});const result=await controller.runGeneration({id:"quota-job",action:"generate",account:{id:"account-test",name:"测试账号",platform:"豆包"},payload:{jobId:"quota-job",prompt:"测试",simulateQuotaExhausted:true}});assert.equal(result.quotaExhausted,true);assert.equal(result.notSentVerified,true);assert.equal(result.ok,false);
  });
  await check("监控阶段额度提示优先于页面中的身份验证文字",async()=>{
    const controller=new BrowserController({profileRootProvider:()=>tempRoot,downloadRootProvider:()=>tempRoot,testMode:false});const session={phase:"idle",conversationId:"",testMode:false};controller.open=async()=>session;controller.connect=async()=>({});controller.detect=async()=>({loggedIn:true});controller.restoreConversation=async()=>{session.conversationId="monitor-conversation";};controller.readSubmissionState=async()=>({quotaExhausted:true,quotaMessage:truth.monitorQuotaMessage,verification:true,scopedGenerating:false,conversationId:"monitor-conversation"});
    const result=await controller.runGeneration({id:"monitor-quota-priority",action:"monitor",account:{id:"account-priority",name:"优先级测试"},payload:{jobId:"monitor-quota-priority",prompt:"生成测试视频",conversationId:"monitor-conversation"}});assert.equal(result.ok,false);assert.equal(result.quotaExhausted,true);assert.equal(result.verificationRequired,undefined);assert.equal(result.safeToRetry,true);
  });
  await check("内嵌豆包导航使用原生 loadURL 并重置旧调试会话",async()=>{
    const controller=new BrowserController({profileRootProvider:()=>tempRoot,downloadRootProvider:()=>tempRoot,testMode:false});let closed=0,loaded="";const session={embedded:true,cdp:{close:()=>{closed+=1}},webContents:{loadURL:async url=>{loaded=url},getURL:()=>loaded}};const result=await controller.navigateSession(session,"https://www.doubao.com/chat/");assert.equal(closed,1);assert.equal(session.cdp,null);assert.equal(loaded,"https://www.doubao.com/chat/");assert.equal(result.url,loaded);
  });
  await check("创作任务提交提示不再使用阻塞式 alert",()=>{
    const sources=["../src/renderer/app.js","../src/renderer/app-fixes.js","../src/renderer/generation-fixes.js"].map(file=>fs.readFileSync(path.join(__dirname,file),"utf8"));assert(sources.every(source=>!/alert\s*\(/.test(source)));assert(sources.some(source=>source.includes("lingframe-toast-stack")));assert(sources.some(source=>source.includes("你可以继续操作其他模块")));
  });
  const failed=checks.filter(item=>!item.ok);const report={test:"doubao-quota-scheduler",timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};fs.mkdirSync(path.join(__dirname,"log"),{recursive:true});fs.writeFileSync(path.join(__dirname,"log/doubao-quota-scheduler.json"),JSON.stringify(report,null,2));console.log(JSON.stringify({test:report.test,total:report.total,passed:report.passed,failed:report.failed,failures:failed},null,2));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
