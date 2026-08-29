"use strict";
const fs=require("fs"),path=require("path"),vm=require("vm");
const root=path.resolve(__dirname,"..");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references","submission-lifecycle-ground-truth.json"),"utf8"));
const browserPath=path.join(root,"src","main","browser-controller.cjs");
const orchestratorPath=path.join(root,"src","main","generation-orchestrator.cjs");
const browserSource=fs.readFileSync(browserPath,"utf8"),orchestratorSource=fs.readFileSync(orchestratorPath,"utf8");
const {BrowserController}=require(browserPath);
const {GenerationOrchestrator}=require(orchestratorPath);
const checks=[];const check=(name,ok,detail=null)=>checks.push({name,ok:Boolean(ok),detail});

(async()=>{
  let waitCalls=0;
  const controller=new BrowserController({profileRootProvider:()=>root,downloadRootProvider:()=>root,testMode:true});
  controller.runGeneration=async command=>({ok:true,generating:true,conversationId:"123456789",submittedEvidence:{prompt:command.payload.prompt}});
  controller.waitForVideo=async()=>{waitCalls+=1;return{url:"mock://video/result",mimeType:"video/mp4",conversationId:"123456789"}};
  controller.downloader.download=async()=>({resultPath:path.join(root,"mock-result.mp4"),downloadAudit:{mock:true}});
  const command={id:"job-lifecycle",account:{id:"account-1",name:"A",platform:"豆包"},payload:{jobId:"job-lifecycle",prompt:truth.preservedEvidencePrompt}};
  const generated=await controller.execute({...command,action:"generate"});
  check("首次提交立即返回生成中",generated.generating===true&&waitCalls===truth.generateWaitCalls,{generated,waitCalls});
  const monitored=await controller.execute({...command,action:"monitor"});
  check("只有监控动作等待视频",waitCalls===truth.monitorWaitCalls&&monitored.state==="completed",{monitored,waitCalls});

  const task={id:"task-1",title:"任务",state:"generating",progress:45,executionChannel:"doubao",accountId:"account-1",accountName:"A",conversationId:"123456789",projectId:"project-1",prompt:truth.preservedEvidencePrompt,evidence:{prompt:truth.preservedEvidencePrompt,conversationId:"123456789",evidenceType:"current-conversation-generation-status"}};
  const reports=[];
  const taskStore={bootstrap:()=>({tasks:[task]}),reportTask:(_id,patch)=>{reports.push({...patch});Object.assign(task,patch);return task}};
  const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>"tenant-1",tasks:taskStore,modelGateway:{},agentBridge:{browser:{execute:async()=>({ok:true,generating:true,conversationId:"123456789",message:"仍在生成"})}},dataRootProvider:()=>root});
  orchestrator.beginBrowserTask=async()=>{};orchestrator.scheduleMonitor=()=>{};
  await orchestrator.runDoubao(task,"monitor");
  check("监控阶段保持生成中状态",reports.length>0&&reports.every(item=>item.state!=="checking_login")&&task.state===truth.monitorVisibleState,reports);
  check("监控阶段保留原提交证据",task.evidence?.prompt===truth.preservedEvidencePrompt,task.evidence);
  check("视频模式使用动作栏或视频输入框多证据确认",browserSource.includes('data-input-engine-actionbar-control-key="video-model"')&&browserSource.includes("return {active:Boolean(model||params||composer),videoComposer:Boolean(composer)"));
  let modeProbeCalls=0;
  const modeController=new BrowserController({profileRootProvider:()=>root,downloadRootProvider:()=>root,testMode:false});
  let modeMouseEvents=0;
  modeController.connect=async()=>({send:async method=>{if(method==="Input.dispatchMouseEvent")modeMouseEvents+=1;return{};}});
  modeController.evaluate=async(_session,expression)=>{
    if(expression.includes("doubao-video-mode-state")){modeProbeCalls+=1;return{active:true,videoComposer:true,legacyControls:false};}
    throw new Error(`未覆盖的视频模式表达式：${expression.slice(0,80)}`);
  };
  const recoveredMode=await modeController.ensureVideoMode({testMode:false});
  check("新版仅有视频输入框时直接确认且不会退回普通对话",recoveredMode===true&&modeProbeCalls===1&&modeMouseEvents===0,{modeProbeCalls,modeMouseEvents});
  let modelProbeCalls=0;
  const delayedController=new BrowserController({profileRootProvider:()=>root,downloadRootProvider:()=>root,testMode:false});
  let parameterMouseEvents=0;
  delayedController.connect=async()=>({send:async(method)=>{if(method==="Input.dispatchMouseEvent")parameterMouseEvents+=1;return{};}});
  delayedController.evaluate=async(_session,expression)=>{
    if(expression.includes("const model=")&&expression.includes("paramsControl"))return{model:true,ratio:true,duration:true};
    if(expression.includes("input[type=\"range\"]")||expression.includes("input[type='range']"))return{method:"native"};
    if(expression.includes('[role="radio"]'))return{x:300,y:300,text:"16:9"};
    if(expression.includes('video-generation-params-panel'))return{x:220,y:220,text:"自动 · 10s"};
    if(expression.includes('video-model')){modelProbeCalls+=1;return modelProbeCalls>=3?{x:120,y:120,selected:true,text:"模型 Seedance 2.0 Mini"}:false;}
    throw new Error(`未覆盖的参数识别表达式：${expression.slice(0,80)}`);
  };
  const delayedParameters=await delayedController.setVideoParameters({testMode:false},{doubaoModel:"Seedance 2.0 Mini",ratio:"16:9",duration:"4s"});
  check("模型控件延迟渲染时会等待并重试",modelProbeCalls===3&&parameterMouseEvents===6&&delayedParameters.model==="Seedance 2.0 Mini"&&delayedParameters.ratio==="16:9"&&delayedParameters.duration===4,{modelProbeCalls,parameterMouseEvents,delayedParameters});
  const humanController=new BrowserController({profileRootProvider:()=>root,downloadRootProvider:()=>root,testMode:false});
  const humanMouseEvents=[];
  humanController.evaluate=async()=>({x:640,y:720,label:"生成",reason:""});
  humanController.connect=async()=>({send:async(method,params)=>{if(method==="Input.dispatchMouseEvent")humanMouseEvents.push({...params});return{};}});
  const humanClicked=await humanController.clickComposerSend({});
  check("发送使用真人轨迹 CDP 点击",humanClicked===true&&humanMouseEvents.length===6&&humanMouseEvents.filter(item=>item.type==="mouseMoved").length===4&&humanMouseEvents.at(-2)?.type==="mousePressed"&&humanMouseEvents.at(-1)?.type==="mouseReleased",humanMouseEvents);
  const lockController=new BrowserController({profileRootProvider:()=>root,downloadRootProvider:()=>root,testMode:true});
  const lockOrder=[];
  const firstLock=lockController.withSubmissionLock("account-1",async()=>{lockOrder.push("first-start");await new Promise(resolve=>setTimeout(resolve,25));lockOrder.push("first-end");});
  const secondLock=lockController.withSubmissionLock("account-2",async()=>{lockOrder.push("second-start");lockOrder.push("second-end");});
  await Promise.all([firstLock,secondLock]);
  check("不同账号提交可并行",lockOrder.indexOf("second-end")<lockOrder.indexOf("first-end"),lockOrder.slice());
  lockOrder.length=0;
  const sameFirst=lockController.withSubmissionLock("account-1",async()=>{lockOrder.push("first-start");await new Promise(resolve=>setTimeout(resolve,25));lockOrder.push("first-end");});
  const sameSecond=lockController.withSubmissionLock("account-1",async()=>{lockOrder.push("second-start");lockOrder.push("second-end");});
  await Promise.all([sameFirst,sameSecond]);
  check("同账号提交严格串行",lockOrder.join(",")==="first-start,first-end,second-start,second-end",lockOrder.slice());
  check("提交失败不得自动回退重提",!browserSource.includes("!retryCount && after?.userMessage && after?.explicitFallback")&&!browserSource.includes("retryCount = 1"));
  check("监控超时为短轮询",browserSource.includes(`monitorTimeoutMs || ${truth.monitorTimeoutMs}`));
  try{new vm.Script(browserSource);new vm.Script(orchestratorSource);check("关键脚本语法",true)}catch(error){check("关键脚本语法",false,error.message)}

  const failed=checks.filter(item=>!item.ok);
  const report={test:"submission-lifecycle",timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
  fs.mkdirSync(path.join(root,"scripts","log"),{recursive:true});
  fs.writeFileSync(path.join(root,"scripts","log","submission-lifecycle.json"),JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
