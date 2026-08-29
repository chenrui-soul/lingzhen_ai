"use strict";

const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {BrowserController,normalizeReferenceAssets}=require("../src/main/browser-controller.cjs");
const {GenerationOrchestrator,generatedAssetMetadata}=require("../src/main/generation-orchestrator.cjs");
const {WorkbenchDataBridge}=require("../src/main/workbench-data-bridge.cjs");

const referencePath=path.join(__dirname,"../references/doubao-reference-upload-ground-truth.json");
const truth=JSON.parse(fs.readFileSync(referencePath,"utf8"));
const fixtureRoot=path.join(__dirname,"../references/doubao-reference-upload-fixtures");
fs.mkdirSync(fixtureRoot,{recursive:true});
const onePixelPng=Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nL8AAAAASUVORK5CYII=","base64");
const fixtureNames=["person-reference.png","scene-reference.png","prop-reference.png"];
for(const name of fixtureNames)fs.writeFileSync(path.join(fixtureRoot,name),onePixelPng);
fs.writeFileSync(referencePath,JSON.stringify({...truth,generatedAt:new Date().toISOString(),fixtureNames},null,2)+"\n","utf8");

const results=[];
const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
const waitFor=async(predicate,timeout=4000)=>{const started=Date.now();while(Date.now()-started<timeout){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("等待专项测试状态超时");};

(async()=>{
  await check("测试数据写入 references 并与 Ground Truth 数量一致",()=>{
    assert.equal(fixtureNames.length,truth.referenceCount);
    for(const name of fixtureNames){const file=path.join(fixtureRoot,name);assert(fs.existsSync(file));assert(fs.statSync(file).size>0);}
  });

  await check("参考图规范化保留真实绝对路径并去重",()=>{
    const first=path.join(fixtureRoot,fixtureNames[0]);
    const normalized=normalizeReferenceAssets({imageAssets:[
      {id:"person",name:"人物参考图",type:"image",mime:"image/png",path:first},
      {id:"person-copy",name:"重复人物图",type:"image",mime:"image/png",path:first},
      {id:"scene",name:"场景参考图",type:"image",mime:"image/png",path:path.join(fixtureRoot,fixtureNames[1])}
    ]});
    assert.equal(normalized.length,2);assert(normalized.every(item=>path.isAbsolute(item.path)&&fs.existsSync(item.path)));
  });

  await check("参考图缺失时在发送提示词前返回可安全重试错误",()=>{
    assert.throws(()=>normalizeReferenceAssets({imageAssets:[{id:"missing",name:"丢失图片",type:"image",path:path.join(fixtureRoot,"missing.png")}]}),error=>error.code==="DOUBAO_ASSET_UPLOAD_FAILED"&&error.notSentVerified===true&&error.safeToRetry===true&&error.quotaConsumed===false);
  });

  await check("参考图按顺序逐张上传并形成完整上传证据",async()=>{
    const controller=new BrowserController({profileRootProvider:()=>fixtureRoot,testMode:false});
    const assets=fixtureNames.map((name,index)=>({id:`asset-${index+1}`,name,originalName:name,type:"image",mime:"image/png",path:path.join(fixtureRoot,name)}));
    const order=[];
    controller.uploadSingleReferenceImage=async(_session,asset,index,total)=>{order.push(asset.id);return{assetId:asset.id,name:asset.name,index:index+1,total,verified:true,verifiedBy:"ground-truth"};};
    const evidence=await controller.uploadReferenceImages({testMode:false},{imageAssets:assets});
    assert.deepStrictEqual(order,["asset-1","asset-2","asset-3"]);assert.equal(evidence.requestedCount,truth.referenceCount);assert.equal(evidence.uploadedCount,truth.referenceCount);assert.equal(evidence.verified,true);assert.equal(evidence.items.length,truth.referenceCount);
  });

  await check("真实浏览器上传实现使用 CDP 文件输入并先上传后填写提示词",()=>{
    const setSource=BrowserController.prototype.setReferenceFile.toString();
    const runSource=BrowserController.prototype.runGeneration.toString();
    assert(setSource.includes("DOM.setFileInputFiles"));
    assert(runSource.indexOf("uploadReferenceImages")>=0&&runSource.indexOf("uploadReferenceImages")<runSource.indexOf("fillComposer"));
  });

  await check("创作首页任务把三个素材 ID 解析为三个真实图片文件",async()=>{
    const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-reference-upload-")),tenantRoot=path.join(tempRoot,"tenant-reference-test");
    const tasks=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});const project=tasks.bootstrap().projects[0];
    const imported=tasks.importAssets({projectId:project.id,paths:fixtureNames.map(name=>path.join(fixtureRoot,name)),source:"model-gateway-generation"});
    let browserCommand=null;
    const browser={execute:async command=>{browserCommand=command;const items=command.payload.imageAssets.map((asset,index)=>({assetId:asset.id,name:asset.name,index:index+1,total:command.payload.imageAssets.length,verified:true,verifiedBy:"fixture"}));return{ok:true,generating:true,conversationId:"123456789",submittedEvidence:{prompt:command.payload.prompt,conversationId:"123456789",referenceUpload:{requestedCount:items.length,uploadedCount:items.length,verified:true,items}}};}};
    const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>"tenant-reference-test",tasks,modelGateway:{},agentBridge:{browser},dataRootProvider:()=>tenantRoot});
    const created=await orchestrator.create({projectId:project.id,title:"10秒悬疑反转短片",prompt:"根据参考图生成视频",creationType:"video",creationSource:"home",executionChannel:"doubao",accountId:"desktop-1",accountName:"白同学",assetIds:imported.map(item=>item.id),ratio:"16:9",duration:"10s"});
    await waitFor(()=>browserCommand);
    assert.equal(browserCommand.payload.imageAssets.length,truth.referenceCount);assert.deepStrictEqual(browserCommand.payload.imageAssetIds,imported.map(item=>item.id));assert(browserCommand.payload.imageAssets.every(item=>path.isAbsolute(item.path)&&fs.existsSync(item.path)));
    const persisted=await waitFor(()=>{const item=tasks.bootstrap().tasks.find(task=>task.id===created.id);return item?.evidence?.referenceUpload?item:null;});
    assert.equal(persisted.evidence.referenceUpload.uploadedCount,truth.referenceCount);assert.equal(persisted.evidence.referenceUpload.verified,true);orchestrator.dispose();
  });

  await check("生成结果使用可搜索的语义化素材名称和标签",()=>{
    const metadata=generatedAssetMetadata({id:"task-1",title:"10秒悬疑反转短片",creationSource:"home",accountName:"白同学"},"video","doubao");
    assert(metadata.name.endsWith(truth.expectedResultNameSuffix));assert(metadata.tags.includes("创作首页"));assert(metadata.tags.includes("豆包生成"));assert(metadata.notes.includes("白同学"));
  });

  await check("素材中心收到完成事件后失效缓存并重新读取数据",()=>{
    const source=fs.readFileSync(path.join(__dirname,"../src/renderer/project-materials.js"),"utf8");
    for(const marker of truth.expectedMaterialRefreshMarkers)assert(source.includes(marker),marker);
    assert(source.includes('detail.state!=="completed"||!detail.resultAssetId'));
    assert(source.includes('[data-page="projects"],[data-page="materials"],[data-page="resources"]'));
    assert(source.includes('const targetPage=target.dataset.page'));
    assert(source.includes('pendingResultAssetId:detail.resultAssetId'));
    assert(source.includes('assetStatus:"active",assetType:"all"'));
    assert(source.includes('recent-result'));
  });

  await check("当前保护基线包含参考图上传实现",()=>{
    const current=fs.readFileSync(path.join(__dirname,"../src/main/browser-controller.cjs"),"utf8");
    assert(current.includes("DOM.setFileInputFiles"));
    assert(current.includes("uploadReferenceImages"));
  });

  const failed=results.filter(item=>!item.ok),logDir=path.join(__dirname,"log");fs.mkdirSync(logDir,{recursive:true});
  const report={test:"doubao-reference-upload-material-refresh",groundTruth:referencePath,total:results.length,passed:results.length-failed.length,failed:failed.length,results};
  fs.writeFileSync(path.join(logDir,"doubao-reference-upload-material-refresh.json"),JSON.stringify(report,null,2)+"\n","utf8");
  console.log(`DOUBAO_REFERENCE_UPLOAD_MATERIAL_REFRESH ${report.passed}/${report.total}`);
  if(failed.length){for(const item of failed)console.error(item.name,item.error);process.exit(1);}
})();
