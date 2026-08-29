"use strict";

const fs=require("fs");
const os=require("os");
const path=require("path");
const {classifyDoubaoFailureMessage,normalizeReferenceAssets,buildReferencePrompt,buildReferenceManifest}=require("../src/main/browser-controller.cjs");
const {WorkbenchDataBridge}=require("../src/main/workbench-data-bridge.cjs");

const root=path.resolve(__dirname,"..");
const groundTruthPath=path.join(root,"references","doubao-live-dock-reference-intelligence-ground-truth.json");
const groundTruth=JSON.parse(fs.readFileSync(groundTruthPath,"utf8"));
const fixtureRoot=path.join(root,"references","doubao-reference-upload-fixtures");
const logPath=path.join(root,"scripts","log","doubao-live-dock-reference-intelligence.json");
const results=[];
const check=(name,condition,detail="")=>results.push({name,ok:Boolean(condition),detail:condition?"":String(detail||"验证失败")});

const files=["prop-reference.png","person-reference.png","scene-reference.png"];
const inputAssets=groundTruth.referenceAssets.map((item,index)=>({id:`asset-${index+1}`,name:item.name,type:"image",path:path.join(fixtureRoot,files[index]),role:item.role,label:item.label,order:index+1}));
const normalized=normalizeReferenceAssets({imageAssets:inputAssets});
check("参考图数量与 Ground Truth 一致",normalized.length===groundTruth.referenceAssets.length,normalized.length);
check("参考图上传顺序与图号一致",normalized.every((item,index)=>item.order===index+1&&item.role===groundTruth.referenceAssets[index].role),JSON.stringify(normalized));
check("参考图自动生成角色化说明",normalized.every((item,index)=>item.description.includes(groundTruth.referenceAssets[index].descriptionContains)),JSON.stringify(normalized.map(item=>item.description)));

const sourcePrompt="深夜雨中，年轻男人撑着黑伞跑到便利店门口。";
const providerPrompt=buildReferencePrompt(sourcePrompt,normalized);
const manifest=buildReferenceManifest(normalized);
check("豆包提示词保留原始视频内容",providerPrompt.startsWith(`【视频内容】\n${sourcePrompt}`),providerPrompt);
check("豆包提示词包含图1道具映射",providerPrompt.includes("图1（道具）")&&providerPrompt.includes("黑伞"),providerPrompt);
check("豆包提示词包含图2人物映射",providerPrompt.includes("图2（人物/角色）")&&providerPrompt.includes("年轻男人"),providerPrompt);
check("豆包提示词包含图3场景映射",providerPrompt.includes("图3（场景）")&&providerPrompt.includes("雨夜便利店"),providerPrompt);
check("参考图清单数量正确",manifest.length===3,JSON.stringify(manifest));

for(const item of groundTruth.failureCases){const classified=classifyDoubaoFailureMessage(item.text);check(`识别豆包结果：${item.code}`,classified.code===item.code&&classified.retryMode===item.retryMode,JSON.stringify(classified));check(`明确终止后允许人工处理：${item.code}`,classified.terminalFailureVerified===true&&classified.safeToRetry===true,JSON.stringify(classified));}

const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-reference-task-"));
try{
  const bridge=new WorkbenchDataBridge({tenantRootProvider:()=>tempRoot});
  const boot=bridge.bootstrap();const projectId=boot.currentProjectId;
  const imported=bridge.importAssets({projectId,paths:files.map(file=>path.join(fixtureRoot,file)),source:"reference-role-test"});
  const referenceAssets=imported.map((asset,index)=>({assetId:asset.id,role:groundTruth.referenceAssets[index].role,label:groundTruth.referenceAssets[index].label,description:normalized[index].description,order:index+1}));
  const task=bridge.createTask({projectId,title:"参考图映射测试",prompt:sourcePrompt,creationType:"video",executionChannel:"doubao",accountId:"desktop-test",accountName:"测试账号",assetIds:imported.map(item=>item.id),referenceAssets,state:"queued"});
  check("任务持久化参考图用途",task.referenceAssets.length===3&&task.referenceAssets[1].role==="character",JSON.stringify(task.referenceAssets));
  check("任务默认记录阶段状态",task.stage==="queued"&&task.progressMode==="determinate",JSON.stringify({stage:task.stage,progressMode:task.progressMode}));
  const monitored=bridge.reportTask(task.id,{state:"generating",stage:"monitoring",progressMode:"indeterminate",monitorAttempt:3,lastCheckedAt:new Date().toISOString(),statusText:"第 3 次安全检查"});
  check("任务记录监控次数和最近检查时间",monitored.monitorAttempt===3&&monitored.progressMode==="indeterminate"&&Boolean(monitored.lastCheckedAt),JSON.stringify(monitored));
}finally{fs.rmSync(tempRoot,{recursive:true,force:true});}

const generationUi=fs.readFileSync(path.join(root,"src","renderer","generation-ui.js"),"utf8");
const generationCss=fs.readFileSync(path.join(root,"src","renderer","styles","generation-ui.css"),"utf8");
const homeUi=fs.readFileSync(path.join(root,"src","renderer","app-fixes.js"),"utf8");
const orchestrator=fs.readFileSync(path.join(root,"src","main","generation-orchestrator.cjs"),"utf8");
check("任务坞使用右侧栏真实边界",generationUi.includes("getBoundingClientRect()")&&generationUi.includes("rect.left+8")&&generationUi.includes("rect.width-16"),"未发现右侧栏边界布局");
check("右侧栏不可用时保留任务数量入口",generationUi.includes("setProperty('max-width','56px','important')")&&generationUi.includes("`任务${count||''}`")&&generationCss.includes("rail-unavailable"),"未发现任务数量折叠入口");
check("豆包生成中使用不确定进度条",generationUi.includes("isIndeterminate")&&generationUi.includes("generation-live-progress")&&generationCss.includes("lingframe-live-progress"),"未发现阶段式进度条");
check("创作首页支持图号、角色和说明编辑",homeUi.includes("data-home-reference-role")&&homeUi.includes("data-home-reference-edit")&&homeUi.includes("taskReferenceAssets"),"参考图交互缺失");
check("后端监控写入次数和最近检查时间",orchestrator.includes("monitorAttempt:attempt")&&orchestrator.includes("lastCheckedAt:new Date().toISOString()"),"监控阶段元数据缺失");

const report={test:groundTruth.test,groundTruth:groundTruthPath,total:results.length,passed:results.filter(item=>item.ok).length,failed:results.filter(item=>!item.ok).length,results,completedAt:new Date().toISOString()};
fs.mkdirSync(path.dirname(logPath),{recursive:true});fs.writeFileSync(logPath,JSON.stringify(report,null,2),"utf8");
console.log(`DOUBAO_LIVE_DOCK_REFERENCE_INTELLIGENCE ${report.passed}/${report.total}`);
if(report.failed){for(const item of results.filter(item=>!item.ok))console.error(`FAIL ${item.name}: ${item.detail}`);process.exitCode=1;}
