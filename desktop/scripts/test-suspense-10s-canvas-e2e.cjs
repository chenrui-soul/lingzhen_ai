"use strict";
const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const expected=JSON.parse(fs.readFileSync(path.join(root,"references","suspense-10s-canvas-e2e-result.json"),"utf8"));
const dataFile=process.env.LINGFRAME_E2E_DATA||path.join(process.env.APPDATA||"","灵帧AI","tenants",expected.tenantId,"database","workbench-data-v1.json");
const data=JSON.parse(fs.readFileSync(dataFile,"utf8"));
const results=[];
const check=(name,condition,detail="")=>results.push({name,passed:Boolean(condition),detail:condition?"":String(detail)});
for(const [key,spec] of Object.entries(expected.tasks)){
  const task=(data.tasks||[]).find(item=>item.id===spec.id);
  check(`${key}: task exists`,Boolean(task),spec.id);
  if(!task)continue;
  check(`${key}: tenant isolated`,task.tenantId===expected.tenantId,task.tenantId);
  check(`${key}: project isolated`,task.projectId===expected.projectId,task.projectId);
  check(`${key}: state`,task.state===spec.state,task.state);
  if(spec.resultType){
    const asset=(data.assets||[]).find(item=>item.id===task.resultAssetId);
    check(`${key}: result asset`,Boolean(asset),task.resultAssetId);
    check(`${key}: result type`,asset?.type===spec.resultType,asset?.type);
    check(`${key}: result file exists`,Boolean(asset?.path&&fs.existsSync(asset.path)),asset?.path);
    check(`${key}: generated source`,["model-gateway-generation","doubao-generation"].includes(asset?.source),asset?.source);
  }
  if(spec.resultUrlRequired)check(`${key}: result URL`,Boolean(task.resultVid&&/^https?:\/\//.test(task.resultVid)),task.resultVid);
  if(spec.failureCode)check(`${key}: failure code`,task.failureCode===spec.failureCode,task.failureCode);
  if(spec.retryMode)check(`${key}: retry mode`,task.retryMode===spec.retryMode,task.retryMode);
  if(typeof spec.safeToRetry==="boolean")check(`${key}: safe retry flag`,task.safeToRetry===spec.safeToRetry,task.safeToRetry);
}
const output={at:new Date().toISOString(),dataFile,total:results.length,passed:results.filter(item=>item.passed).length,failed:results.filter(item=>!item.passed).length,results};
fs.mkdirSync(path.join(root,"scripts","log"),{recursive:true});
fs.writeFileSync(path.join(root,"scripts","log","suspense-10s-canvas-e2e.json"),JSON.stringify(output,null,2),"utf8");
console.log(`SUSPENSE_CANVAS_E2E ${output.passed}/${output.total}`);
if(output.failed){for(const item of results.filter(value=>!value.passed))console.error(item.name,item.detail);process.exitCode=1;}
