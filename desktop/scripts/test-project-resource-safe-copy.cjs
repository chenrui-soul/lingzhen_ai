"use strict";
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge, inside} = require("../src/main/workbench-data-bridge.cjs");

const root=path.resolve(__dirname,"..");
const truthFile=path.join(root,"references","project-resource-safe-copy-ground-truth.json");
const truth=JSON.parse(fs.readFileSync(truthFile,"utf8"));
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-resource-safe-copy-"));
const tenantRoot=path.join(testRoot,"tenant-safe-copy");
const bridge=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const checks=[];
function check(name,fn){try{fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:String(error.message||error)})}}
function rejects(name,fn,pattern){check(name,()=>{let error;try{fn()}catch(value){error=value}assert(error,"预期操作应被拒绝");assert.match(String(error.message||error),pattern)})}

const sourceProject=bridge.bootstrap().projects[0];
const targetProject=bridge.createProject({name:"安全复制目标"});
const sourceDir=path.join(testRoot,"source");fs.mkdirSync(sourceDir,{recursive:true});
const files=["copy.png","task.png","result.png","text.txt","free.png"].map(name=>path.join(sourceDir,name));
for(const [index,file] of files.entries())fs.writeFileSync(file,index===3?"文本引用素材":Buffer.from(`asset-${index}`));
const [copySource,taskAsset,resultAsset,textAsset,freeAsset]=bridge.importAssets({projectId:sourceProject.id,paths:files});

bridge.updateAsset(copySource.id,{name:"可安全复制素材",tags:"安全, 复制",notes:"保持原归属"});
check("metadata edit does not require project reassignment",()=>{const asset=bridge.resolveAsset(copySource.id);assert.equal(asset.name,"可安全复制素材");assert.equal(asset.projectId,sourceProject.id)});
rejects("direct project reassignment is rejected",()=>bridge.updateAsset(copySource.id,{projectId:targetProject.id}),/复制到项目|新的 assetId/);
const copyResult=bridge.copyAssets({assetIds:[copySource.id],targetProjectId:targetProject.id});
const copied=copyResult.assets[0];
check("copy creates a new asset id",()=>{assert(copyResult.mapping[0].copied);assert.notEqual(copied.id,copySource.id)});
check("copy keeps original project and file",()=>{const source=bridge.resolveAsset(copySource.id);assert.equal(source.projectId,sourceProject.id);assert(fs.existsSync(source.path));assert(inside(path.join(tenantRoot,"materials",sourceProject.id),source.path))});
check("copy creates independent target file",()=>{const source=bridge.resolveAsset(copySource.id),target=bridge.resolveAsset(copied.id);assert.equal(target.projectId,targetProject.id);assert.notEqual(target.path,source.path);assert(fs.existsSync(target.path));assert.deepEqual(fs.readFileSync(target.path),fs.readFileSync(source.path))});
check("copy records provenance",()=>{assert.equal(copied.sourceAssetId,copySource.id);assert.equal(copied.sourceProjectId,sourceProject.id);assert.equal(copied.source,"cross-project-copy")});

const conversation=bridge.createConversation({projectId:sourceProject.id,title:"引用素材的文本"});bridge.updateConversation(conversation.id,{assetIds:[textAsset.id]});
rejects("text conversation reference blocks delete",()=>bridge.deleteAsset(textAsset.id),/文本会话.*不能删除/);
const inputTask=bridge.createTask({projectId:sourceProject.id,title:"素材输入任务",prompt:"生成",executionChannel:"model-gateway",assetIds:[taskAsset.id],state:"draft"});
rejects("task input reference blocks delete",()=>bridge.deleteAsset(taskAsset.id),/任务输入.*不能删除/);
bridge.deleteTask(inputTask.id);
rejects("soft-deleted task history still protects input asset",()=>bridge.deleteAsset(taskAsset.id),/任务输入.*不能删除/);
const resultConversationId="conversation-safe-copy";
const resultTask=bridge.createTask({projectId:sourceProject.id,title:"结果任务",prompt:"生成结果",executionChannel:"doubao",accountId:"account-safe",conversationId:resultConversationId,state:"generating"});bridge.completeTask(resultTask.id,{resultAssetId:resultAsset.id,resultVid:"https://example.com/result.mp4",evidence:{tenantId:path.basename(tenantRoot),accountId:"account-safe",conversationId:resultConversationId,submittedAt:new Date().toISOString()}});
rejects("task result reference blocks delete",()=>bridge.deleteAsset(resultAsset.id),/任务结果.*不能删除/);
check("unreferenced asset can be soft deleted and restored",()=>{bridge.deleteAsset(freeAsset.id);assert(bridge.bootstrap().assets.find(item=>item.id===freeAsset.id).deletedAt);bridge.restoreAsset(freeAsset.id);assert.equal(bridge.bootstrap().assets.find(item=>item.id===freeAsset.id).deletedAt,null)});
check("unreferenced copied asset remains independently deletable",()=>{bridge.deleteAsset(copied.id);assert(bridge.bootstrap().assets.find(item=>item.id===copied.id).deletedAt)});

const renderer=fs.readFileSync(path.join(root,"src","renderer","project-materials.js"),"utf8");
const dataBridge=fs.readFileSync(path.join(root,"src","main","workbench-data-bridge.cjs"),"utf8");
const css=fs.readFileSync(path.join(root,"src","renderer","styles","project-materials.css"),"utf8");
check("renderer exposes safe copy action",()=>{for(const marker of ['data-asset-action="copy"',"copyAsset(asset)","api.assets.copy({assetIds:[asset.id],targetProjectId}","sourceAssetId=","复制并查看副本"])assert(renderer.includes(marker),marker)});
check("renderer metadata edit no longer submits projectId",()=>{const edit=renderer.slice(renderer.indexOf("function editAsset"),renderer.indexOf("function previewAsset"));assert(!edit.includes("data-asset-project-edit"));assert(!/api\.assets\.update\([^\n]+projectId/.test(edit));assert(edit.includes("asset-fixed-project"))});
check("renderer scans task text canvas and staged references",()=>{for(const marker of ["textConversations", "canvasAssetUsage", "lingframe.infiniteCanvas.v2.", "data.executionEnvelope?.assetIds", "lingframe.assetReferences", "showAssetUsageDialog"])assert(renderer.includes(marker),marker)});
check("data layer rejects direct move and referenced deletion",()=>{for(const marker of ["素材项目归属不可直接修改", "assetReferenceUsage", "任务输入", "任务结果", "文本会话"])assert(dataBridge.includes(marker),marker);const update=dataBridge.slice(dataBridge.indexOf("updateAsset(assetId"),dataBridge.indexOf("deleteAsset(assetId"));assert(!update.includes("fs.renameSync"))});
check("usage and copy UI styles exist",()=>{for(const marker of [".asset-usage-badge", ".asset-usage-summary", ".asset-copy-source", ".asset-fixed-project"])assert(css.includes(marker),marker)});
check("protected module hashes are unchanged",()=>{for(const [file,expected] of Object.entries(truth.protectedHashes)){const actual=crypto.createHash("sha256").update(fs.readFileSync(path.join(root,file))).digest("hex").toUpperCase();assert.equal(actual,expected,file)}});

const failed=checks.filter(item=>!item.ok);const result={test:truth.test,timestamp:new Date().toISOString(),groundTruth:truthFile,tempRoot:testRoot,total:checks.length,passed:checks.length-failed.length,failed:failed.length,failures:failed,checks};
const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"project-resource-safe-copy.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failed.length)process.exit(1);
