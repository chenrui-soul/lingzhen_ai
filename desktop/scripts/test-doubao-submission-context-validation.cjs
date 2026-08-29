"use strict";
const assert=require("assert");const fs=require("fs");const os=require("os");const path=require("path");
const {validateSubmissionContextState}=require("../src/main/browser-controller.cjs");
const {WorkbenchDataBridge}=require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator}=require("../src/main/generation-orchestrator.cjs");
const root=path.resolve(__dirname,"..");const groundTruthPath=path.join(root,"references","doubao-submission-context-validation-ground-truth.json");const groundTruth=JSON.parse(fs.readFileSync(groundTruthPath,"utf8"));const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:String(error.message||error)})}}
async function main(){
  for(const item of groundTruth.requirements){const actual=validateSubmissionContextState({conversationId:item.currentConversationId,promptPresentInCurrentConversation:item.promptPresentInCurrentConversation,userMessage:item.userMessage,userMessageId:"user-message-1"},item.expectedConversationId);check(`纯函数 Ground Truth：${item.case}`,()=>assert.equal(actual.matched,item.expectedMatched));}
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-context-validation-")),tenant="tenant-context-validation",tenantRoot=path.join(temp,"tenants",tenant),tasks=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot}),project=tasks.bootstrap().projects[0];
  let browserResult={ok:false,matched:false,code:"DOUBAO_SUBMISSION_CONTEXT_MISMATCH",category:"monitor_binding",message:"当前豆包会话没有匹配到该任务提示词，请先打开包含该提示词的正确会话",monitorProbe:{conversationId:"conversation-wrong",requestedConversationId:"conversation-expected",promptMatched:false,conversationMatched:false}},monitorCalls=0;
  const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>tenant,tasks,agentBridge:{browser:{execute:async request=>{assert.equal(request.action,"validate_submission_context");return browserResult;}}},dataRootProvider:()=>tenantRoot});orchestrator.monitor=async taskId=>{monitorCalls+=1;return {ok:true,taskId};};
  const mismatch=tasks.createTask({projectId:project.id,title:"错误会话",prompt:"一只红色风筝飞过海边",executionChannel:"doubao",accountId:"account-mismatch",accountName:"测试账号一",conversationId:"conversation-expected",state:"submission_unknown",submittedVerified:false,safeToRetry:false,notSentVerified:false});orchestrator.holdAccount(mismatch);
  let mismatchError=null;try{await orchestrator.resolveSubmissionUnknown(mismatch.id,"submitted");}catch(error){mismatchError=error;}
  const mismatchTask=tasks.bootstrap().tasks.find(item=>item.id===mismatch.id);
  check("不匹配时返回明确错误",()=>{assert(mismatchError);assert.equal(mismatchError.code,"DOUBAO_SUBMISSION_CONTEXT_MISMATCH");assert.match(mismatchError.message,/正确会话|任务提示词/);});
  check("不匹配时保持人工核对状态",()=>{assert.equal(mismatchTask.state,"submission_unknown");assert.equal(mismatchTask.recoveryState,"submission_context_mismatch");assert.equal(mismatchTask.failureCode,"DOUBAO_SUBMISSION_CONTEXT_MISMATCH");});
  check("不匹配时不确认提交也不进入监控",()=>{assert.equal(mismatchTask.submittedVerified,false);assert.equal(monitorCalls,0);});
  check("不匹配时账号继续锁定",()=>assert.equal(orchestrator.accountOwners.get(`doubao:${tenant}:account-mismatch`),mismatch.id));
  browserResult={ok:true,matched:true,conversationId:"conversation-matched",userMessageId:"user-message-matched",monitorProbe:{conversationId:"conversation-matched",requestedConversationId:"",promptMatched:true,conversationMatched:true}};
  const matched=tasks.createTask({projectId:project.id,title:"正确会话",prompt:"一只蓝色纸飞机穿过云层",executionChannel:"doubao",accountId:"account-matched",accountName:"测试账号二",conversationId:"",state:"submission_unknown",submittedVerified:false,safeToRetry:false,notSentVerified:false});orchestrator.holdAccount(matched);const monitorResult=await orchestrator.resolveSubmissionUnknown(matched.id,"submitted"),matchedTask=tasks.bootstrap().tasks.find(item=>item.id===matched.id);
  check("匹配时只调用一次监控",()=>{assert.equal(monitorCalls,1);assert.equal(monitorResult.taskId,matched.id);});
  check("匹配时保存会话和用户消息证据",()=>{assert.equal(matchedTask.conversationId,"conversation-matched");assert.equal(matchedTask.evidence.conversationId,"conversation-matched");assert.equal(matchedTask.evidence.userMessageId,"user-message-matched");assert.equal(matchedTask.submittedVerified,true);assert.equal(matchedTask.recoveryState,"submission_context_validated");});
  const failed=checks.filter(item=>!item.ok),report={test:"doubao-submission-context-validation",groundTruth:groundTruthPath,timestamp:new Date().toISOString(),total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"doubao-submission-context-validation.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failed.length)process.exitCode=1;
}
main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
