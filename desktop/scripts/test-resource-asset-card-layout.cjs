"use strict";

const fs=require("fs");
const path=require("path");
const root=path.resolve(__dirname,"..");
const truth=JSON.parse(fs.readFileSync(path.join(root,"references","resource-asset-card-layout-ground-truth.json"),"utf8"));
const css=fs.readFileSync(path.join(root,"src","renderer","styles","project-materials.css"),"utf8");
const source=fs.readFileSync(path.join(root,"src","renderer","project-materials.js"),"utf8");
const compact=css.replace(/\s+/g,"");
const checks=[];const check=(name,value,detail=null)=>checks.push({name,ok:Boolean(value),detail});

check("素材卡片使用稳定底部结构",source.includes("asset-card-footer")&&source.includes("asset-card-controls")&&source.includes("asset-action-menu"));
check("底部操作区不换行",compact.includes(".resource-asset-grid.asset-card-footer{min-width:0;flex-wrap:nowrap;align-items:center}"));
check("引用数文字不竖排",compact.includes(".resource-asset-grid.asset-card-footer.asset-usage-badge,.resource-asset-grid.asset-card-footer.asset-unused{flex:01auto;min-width:0;max-width:calc(100%-124px);white-space:nowrap"));
check("快捷操作和菜单文字不换行",compact.includes(".resource-asset-grid.asset-quick-action,.resource-asset-grid.asset-action-menu>summary{white-space:nowrap;word-break:keep-all"));
check("删除与操作入口保留",truth.requiredActions.every(label=>source.includes(label)));

const failed=checks.filter(item=>!item.ok);const report={test:truth.feature,timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"resource-asset-card-layout.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failed.length)process.exitCode=1;
