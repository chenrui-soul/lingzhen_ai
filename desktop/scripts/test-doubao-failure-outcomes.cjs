"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {classifyDoubaoFailureMessage}=require("../src/main/browser-controller.cjs");
const {WorkbenchDataBridge}=require("../src/main/workbench-data-bridge.cjs");

const root=path.resolve(__dirname,"..");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references","doubao-failure-outcomes-ground-truth.json"),"utf8"));
const checks=[];
const check=(name,fn)=>{try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error.stack||String(error)});}};

for(const item of truth.cases){
  check(`classify: ${item.name}`,()=>{
    const actual=classifyDoubaoFailureMessage(item.text);
    for(const [key,value] of Object.entries(item.expected))assert.deepStrictEqual(actual[key],value,`${key}: ${JSON.stringify(actual)}`);
    if(item.expected.failed!==false){assert.equal(actual.providerTerminal,true);assert.equal(actual.terminalFailureVerified,true);assert.equal(actual.safeToRetry,true);assert(actual.providerMessage);assert(actual.userAction);}
  });
}

const temp=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-doubao-failure-"));
const bridge=new WorkbenchDataBridge({tenantRootProvider:()=>path.join(temp,"tenant-a")});
const project=bridge.createProject({name:"failure test"});
const original=bridge.createTask({projectId:project.id,title:"risk task",prompt:"原始违规提示词",executionChannel:"doubao",state:"generating",accountId:"account-a",accountName:"A",doubaoModel:"Seedance 2.0 Mini",ratio:"16:9",duration:10});
const rejected=bridge.reportTask(original.id,{state:"failed",statusText:"豆包已拒绝本次内容，请修改提示词后重新提交",error:"生成内容中疑似包含侵权 / 违规内容",safeToRetry:true,notSentVerified:false,terminalFailureVerified:true,retryMode:"edit_prompt",requiresPromptEdit:true,failureCode:"DOUBAO_CONTENT_REJECTED",failureCategory:"content_policy",providerMessage:"生成内容中疑似包含侵权 / 违规内容，无法返回该内容，生成额度未扣除",userAction:"请修改提示词",quotaConsumed:false});

check("terminal provider failure fields persist",()=>{assert.equal(rejected.state,"failed");assert.equal(rejected.terminalFailureVerified,true);assert.equal(rejected.retryMode,"edit_prompt");assert.equal(rejected.quotaConsumed,false);assert.equal(rejected.failureCode,"DOUBAO_CONTENT_REJECTED");});
check("unchanged rejected prompt cannot retry",()=>assert.throws(()=>bridge.retryTask(original.id,{prompt:"原始违规提示词"}),/修改提示词/));
check("modified prompt creates child and preserves original",()=>{const child=bridge.retryTask(original.id,{prompt:"修改后的安全提示词",ratio:"9:16",duration:6});assert.equal(child.parentTaskId,original.id);assert.equal(child.prompt,"修改后的安全提示词");assert.equal(child.state,"queued");assert.equal(child.ratio,"9:16");assert.equal(child.duration,"6s");assert.equal(child.terminalFailureVerified,false);const snapshot=bridge.bootstrap();assert(snapshot.tasks.some(item=>item.id===original.id&&item.state==="failed"));assert(snapshot.tasks.some(item=>item.id===child.id&&item.state==="queued"));});

check("renderer provides modify-and-retry dialog",()=>{const source=fs.readFileSync(path.join(root,"src/renderer/task-center.js"),"utf8");for(const marker of ["修改后重试","data-retry-prompt","data-retry-model","data-retry-ratio","data-retry-duration","terminalFailureVerified","账号队列已释放"])assert(source.includes(marker),marker);});
check("retry IPC starts the child task",()=>{const main=fs.readFileSync(path.join(root,"src/main/main.cjs"),"utf8"),orchestrator=fs.readFileSync(path.join(root,"src/main/generation-orchestrator.cjs"),"utf8"),preload=fs.readFileSync(path.join(root,"src/preload/preload.cjs"),"utf8");assert(main.includes("generationOrchestrator.retryTask(taskId,input||{})"));assert(orchestrator.includes("this.run(task.id).catch(()=>{})"));assert(preload.includes("retry:(id,input)"));});
check("orchestrator releases explicit terminal failures",()=>{const source=fs.readFileSync(path.join(root,"src/main/generation-orchestrator.cjs"),"utf8");for(const marker of ["handleProviderTerminalFailure","terminalFailureVerified","this.releaseAccount(taskId)","provider_terminal_failure"])assert(source.includes(marker),marker);});
check("unknown submission remains protected and is audited without resubmit",()=>{const source=fs.readFileSync(path.join(root,"src/main/generation-orchestrator.cjs"),"utf8"),controller=fs.readFileSync(path.join(root,"src/main/browser-controller.cjs"),"utf8");assert(source.includes('state: submissionUnknown ? "submission_unknown" : "failed"'));assert(source.includes("if(!submissionUnknown)this.releaseAccount(taskId)"));assert(source.includes("scheduleUnknownAudit"));assert(source.includes("auditSubmissionUnknown"));assert(controller.includes("terminalProbe"));assert(controller.includes("继续保持提交状态未知；不会重新提交"));});
check("result recovery never regenerates",()=>{const source=fs.readFileSync(path.join(root,"src/main/generation-orchestrator.cjs"),"utf8");assert(source.includes("scheduleModelRecovery"));assert(source.includes('action:"recover_result"'));assert(source.includes("不会重新生成视频"));});

const failed=checks.filter(item=>!item.ok);const report={test:"doubao-failure-outcomes",timestamp:new Date().toISOString(),groundTruth:path.relative(root,path.join(root,"references","doubao-failure-outcomes-ground-truth.json")),total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};fs.mkdirSync(path.join(root,"scripts","log"),{recursive:true});fs.writeFileSync(path.join(root,"scripts","log","doubao-failure-outcomes.json"),JSON.stringify(report,null,2),"utf8");process.stdout.write(`${JSON.stringify({test:report.test,total:report.total,passed:report.passed,failed:report.failed,failures:failed},null,2)}\n`);if(failed.length)process.exitCode=1;
