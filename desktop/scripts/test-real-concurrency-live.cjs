"use strict";
const fs=require("fs"),path=require("path");
const root=path.resolve(__dirname,"..");
const logPath=path.join(root,"scripts","log","real-concurrency-live.json");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function connect(){
  const targets=await fetch("http://127.0.0.1:9333/json/list").then(response=>response.json());
  const target=targets.find(item=>item.type==="page"&&item.url.includes("lingzhen_ai_desktop_v1"));
  if(!target)throw new Error("未找到灵帧AI桌面版调试页面");
  const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject});
  let sequence=0;const pending=new Map();ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id)}};
  const send=(method,params={})=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const reply=await send("Runtime.evaluate",{expression,returnByValue:true,awaitPromise:true});if(reply.result?.exceptionDetails)throw new Error(reply.result.exceptionDetails.text||"页面执行失败");return reply.result.result.value};
  return {ws,evaluate};
}
function save(report){fs.mkdirSync(path.dirname(logPath),{recursive:true});fs.writeFileSync(logPath,JSON.stringify(report,null,2));}
(async()=>{
  const {ws,evaluate}=await connect();
  const runId=`LIVE-${new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14)}`;
  const context=await evaluate(`(async()=>{const data=await window.lingframe.workbench.bootstrap();const providers=await window.lingframe.models.bootstrap();return {projectId:data.currentProjectId,providers:providers.map(p=>({id:p.id,name:p.name,models:(p.models||[]).filter(m=>m.enabled!==false).map(m=>({id:m.id,name:m.displayName,type:m.capabilities?.type||''}))})),accounts:window.lingframeAccountStore.accounts().map(a=>({id:a.id,name:a.name})),tasks:(data.tasks||[]).map(t=>({id:t.id,title:t.title,state:t.state}))}})()`);
  const accountA=context.accounts.find(item=>item.id==="desktop-1"),accountB=context.accounts.find(item=>item.id==="desktop-2");
  const provider=context.providers.find(item=>item.models.some(model=>model.type==="text"))||context.providers[0];const model=provider?.models.find(item=>item.type==="text")||provider?.models[0];
  if(!accountA||!accountB||!provider||!model)throw new Error("缺少两个豆包账号或可用文本模型");
  const specs=[
    {key:"sameA1",title:`${runId}-SAME-A1`,input:{prompt:"Create a 5-second video of a blue paper airplane flying over a white table. No text.",projectId:context.projectId,creationType:"video",executionChannel:"doubao",accountId:accountA.id,accountName:accountA.name,ratio:"16:9",duration:"5s"}},
    {key:"sameA2",title:`${runId}-SAME-A2`,input:{prompt:"Create a 5-second video of a green glass marble rolling on black cloth. No text.",projectId:context.projectId,creationType:"video",executionChannel:"doubao",accountId:accountA.id,accountName:accountA.name,ratio:"16:9",duration:"5s"}},
    {key:"otherB",title:`${runId}-OTHER-B`,input:{prompt:"Create a 5-second video of a red pinwheel spinning in sunlight. No text.",projectId:context.projectId,creationType:"video",executionChannel:"doubao",accountId:accountB.id,accountName:accountB.name,ratio:"16:9",duration:"5s"}},
    {key:"gateway",title:`${runId}-GATEWAY`,input:{prompt:`Reply exactly: MODEL_GATEWAY_OK_${runId}`,projectId:context.projectId,creationType:"text",executionChannel:"model-gateway",providerId:provider.id,modelId:model.id}}
  ];
  const report={runId,startedAt:new Date().toISOString(),projectId:context.projectId,accountA:{id:accountA.id,name:accountA.name},accountB:{id:accountB.id,name:accountB.name},provider:{id:provider.id,name:provider.name,modelId:model.id},tasks:{},snapshots:[],acceptance:{sameAccountQueued:false,differentAccountParallel:false,gatewayParallel:false,uniqueOwnership:false,videoUrlsComplete:false},status:"submitting"};save(report);
  for(const spec of specs){
    const existing=await evaluate(`(async()=>{const data=await window.lingframe.workbench.bootstrap();return (data.tasks||[]).find(t=>t.title===${JSON.stringify(spec.title)})||null})()`);
    const task=existing||await evaluate(`window.lingframe.generation.create(${JSON.stringify({...spec.input,title:spec.title})})`);
    report.tasks[spec.key]={id:task.id,title:spec.title,channel:spec.input.executionChannel,accountId:spec.input.accountId||"",modelId:spec.input.modelId||""};save(report);
  }
  report.status="monitoring";save(report);
  const ids=Object.values(report.tasks).map(item=>item.id);const started=Date.now();
  while(Date.now()-started<15*60*1000){
    const rows=await evaluate(`(async()=>{const data=await window.lingframe.workbench.bootstrap();const ids=${JSON.stringify(ids)};return (data.tasks||[]).filter(t=>ids.includes(t.id)).map(t=>({id:t.id,title:t.title,state:t.state,statusText:t.statusText||'',progress:Number(t.progress||0),executionChannel:t.executionChannel,accountId:t.accountId||'',modelId:t.modelId||'',conversationId:t.conversationId||'',resultAssetId:t.resultAssetId||'',resultVid:t.resultVid||'',error:t.error||''}))})()`);
    const byKey=Object.fromEntries(Object.entries(report.tasks).map(([key,item])=>[key,rows.find(row=>row.id===item.id)]));
    report.snapshots.push({at:new Date().toISOString(),tasks:byKey});if(report.snapshots.length>120)report.snapshots.shift();
    const first=byKey.sameA1,second=byKey.sameA2,other=byKey.otherB,gateway=byKey.gateway;
    if(second?.state==="queued"&&first&&first.state!=="queued")report.acceptance.sameAccountQueued=true;
    if(other&&first&&other.state!=="queued"&&first.state!=="queued")report.acceptance.differentAccountParallel=true;
    if(gateway&&["preparing","submitting","verifying","completed"].includes(gateway.state)&&first&&!["completed","failed","cancelled"].includes(first.state))report.acceptance.gatewayParallel=true;
    const terminal=rows.every(row=>["completed","failed","cancelled","submission_unknown","awaiting_verification","awaiting_login"].includes(row.state));
    report.acceptance.uniqueOwnership=rows.every(row=>row.executionChannel==="model-gateway"?row.modelId===model.id:[accountA.id,accountB.id].includes(row.accountId));
    const completedVideos=rows.filter(row=>row.executionChannel==="doubao"&&row.state==="completed");
    report.acceptance.videoUrlsComplete=completedVideos.length===3&&completedVideos.every(row=>/^https?:\/\//.test(row.resultVid)&&row.resultVid.length>300);
    report.status=terminal?"terminal":"monitoring";report.updatedAt=new Date().toISOString();save(report);
    process.stdout.write(JSON.stringify({at:report.updatedAt,status:report.status,acceptance:report.acceptance,tasks:Object.fromEntries(Object.entries(byKey).map(([key,row])=>[key,row?{state:row.state,progress:row.progress,statusText:row.statusText,error:row.error}:null]))})+"\n");
    if(terminal)break;await wait(5000);
  }
  report.finishedAt=new Date().toISOString();if(report.status!=="terminal")report.status="timeout";save(report);ws.close();
  if(!report.acceptance.sameAccountQueued||!report.acceptance.differentAccountParallel||!report.acceptance.gatewayParallel)process.exitCode=1;
})().catch(error=>{fs.mkdirSync(path.dirname(logPath),{recursive:true});fs.writeFileSync(logPath,JSON.stringify({status:"failed",error:String(error.stack||error),at:new Date().toISOString()},null,2));console.error(error);process.exitCode=1});
