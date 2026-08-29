"use strict";

const fs=require("fs");
const path=require("path");
const {WorkbenchDataBridge}=require("../src/main/workbench-data-bridge.cjs");
const {generatedAssetMetadata}=require("../src/main/generation-orchestrator.cjs");

const tenantRoot=path.resolve(String(process.argv[2]||""));
if(!tenantRoot||!fs.existsSync(tenantRoot))throw new Error("请提供有效的租户数据目录");
const bridge=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const boot=bridge.bootstrap(),changes=[];
for(const task of boot.tasks||[]){
  if(!task.resultAssetId||task.state!=="completed")continue;
  const asset=(boot.assets||[]).find(item=>item.id===task.resultAssetId);
  if(!asset||!/(?:generation|model-gateway|doubao)/i.test(asset.source||""))continue;
  const rawName=!asset.name||asset.name===task.id||/^[0-9a-f]{24,40}$/i.test(asset.name);
  const missingTags=!(asset.tags||[]).length;
  if(!rawName&&!missingTags)continue;
  const channel=task.executionChannel==="doubao"||asset.source==="doubao-generation"?"doubao":"model-gateway";
  const metadata=generatedAssetMetadata(task,asset.type,channel);
  const updated=bridge.updateAsset(asset.id,{name:rawName?metadata.name:asset.name,tags:[...(asset.tags||[]),...metadata.tags],notes:asset.notes||metadata.notes});
  changes.push({taskId:task.id,assetId:asset.id,oldName:asset.name,newName:updated.name,tags:updated.tags});
}
const logDir=path.join(__dirname,"log");fs.mkdirSync(logDir,{recursive:true});
const report={tenantRoot,changed:changes.length,changes,completedAt:new Date().toISOString()};
fs.writeFileSync(path.join(logDir,"generated-asset-metadata-backfill.json"),JSON.stringify(report,null,2)+"\n","utf8");
console.log(`GENERATED_ASSET_METADATA_BACKFILL ${changes.length}`);
