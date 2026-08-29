"use strict";
const fs=require("fs");
const os=require("os");
const path=require("path");
const root=path.resolve(__dirname,"..");
const referencePath=path.join(root,"references","infinite-canvas-media-model-v2-ground-truth.json");
const truth=JSON.parse(fs.readFileSync(referencePath,"utf8"));
const core=require(path.join(root,"src","renderer","canvas-flow-core.js"));
require(path.join(root,"src","renderer","canvas-input-adapter.js"));
const {WorkbenchDataBridge}=require(path.join(root,"src","main","workbench-data-bridge.cjs"));
const {ModelGatewayBridge}=require(path.join(root,"src","main","model-gateway-bridge.cjs"));
const logDirectory=path.join(root,"scripts","log");fs.mkdirSync(logDirectory,{recursive:true});
const results=[];const check=(name,condition,detail="")=>results.push({name,passed:Boolean(condition),detail:condition?"":String(detail)});
const fixtureFile=path.join(root,"references","generated-canvas-reference.mp3");
const imageFixtureFile=path.join(root,"references","generated-canvas-reference.png");
fs.writeFileSync(fixtureFile,truth.fixtureContent,"utf8");
fs.writeFileSync(imageFixtureFile,truth.fixtureContent,"utf8");
check("画布核心升级到V4",core.VERSION===truth.schemaVersion,core.VERSION);
check("四类输入节点齐全",truth.inputNodeTypes.every(type=>core.LIBRARY_MAP[type]?.inputNode),truth.inputNodeTypes.filter(type=>!core.LIBRARY_MAP[type]?.inputNode).join(","));
check("图片视频音频生成节点齐全",truth.generationNodeTypes.every(type=>core.LIBRARY_MAP[type]?.executable),"生成节点缺失");
const placementOrigin={x:500,y:400},placementNodes=[];for(let index=0;index<6;index+=1){const position=core.findAvailableNodePosition(placementNodes,placementOrigin);placementNodes.push({id:`p${index}`,position});}
check("连续双击添加节点自动错位避免完全重叠",new Set(placementNodes.map(node=>`${node.position.x}:${node.position.y}`)).size===6,JSON.stringify(placementNodes));
const providers=[{id:"p",name:"测试厂商",models:[
  {id:"text-model",enabled:true,parameters:{temperature:.7},capabilities:{type:"text"}},
  {id:"image-model",enabled:true,parameters:{count:1},capabilities:{type:"image"}},
  {id:"video-model",enabled:true,parameters:{guidance:7},capabilities:{type:"video",modes:["text-to-video","image-to-video"],ratios:["16:9","9:16"],resolutions:["720p","1080p"],durations:["5s","10s"]}}
]}];
const videoModels=core.compatibleModels(providers,"video");
check("模型按生成类别过滤",JSON.stringify(videoModels.map(item=>item.id))===JSON.stringify(truth.expectedVideoModels),JSON.stringify(videoModels.map(item=>item.id)));
const merged=core.mergeModelParameters(videoModels[0],{mode:"image-to-video",duration:"10s"});
check("模型默认与节点参数正确合并",Object.entries(truth.expectedParameters).every(([key,value])=>merged[key]===value),JSON.stringify(merged));
const migrated=core.migrateDocument({schemaVersion:2,nodes:[{id:"n",data:{kind:"image-generation",refs:{assetIds:["a","a"]}}}],edges:[],viewport:{}});
check("旧画布迁移保留并去重素材",migrated.schemaVersion===4&&migrated.nodes[0].data.refs.assetIds.length===1&&migrated.nodes[0].data.modelParameters&&migrated.nodes[0].data.refs.assetRoles,"迁移结果不完整");
const upstreamNodes=[
  {id:"image",data:{kind:"image-input",title:"参考图",refs:{assetIds:["asset-a"]},output:{type:"image"}}},
  {id:"video",data:{kind:"video-generation",title:"视频",instruction:"生成视频",refs:{assetIds:["asset-a","asset-b"]},modelParameters:{duration:"10s"}}}
];
const resolved=core.resolveNodeExecutionInput("video",upstreamNodes,[{id:"e",source:"image",target:"video"}]);
check("本地与上游素材合并去重",JSON.stringify(resolved.assetIds)===JSON.stringify(["asset-a","asset-b"]),JSON.stringify(resolved.assetIds));
const tenantRoot=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-canvas-media-"));
const workbench=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const project=workbench.createProject({name:"媒体测试项目"});
const imported=workbench.importAssets({projectId:project.id,paths:[fixtureFile]})[0];
const importedImage=workbench.importAssets({projectId:project.id,paths:[imageFixtureFile]})[0];
check("音频素材可导入",imported.type==="audio"&&imported.mime===truth.audioMime,JSON.stringify(imported));
const task=workbench.createTask({projectId:project.id,title:"参数任务",prompt:"生成",executionChannel:"model-gateway",providerId:"p",modelId:"video-model",assetIds:[importedImage.id],modelParameters:truth.expectedParameters});
check("任务持久化模型参数",task.modelParameters.duration==="10s"&&task.assetIds[0]===importedImage.id,JSON.stringify(task));
let captured=null;
const gatewayRoot=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-model-media-"));
const gateway=new ModelGatewayBridge({tenantRootProvider:()=>gatewayRoot,secretProvider:()=>"test",requestJson:async(provider,requestPath,options)=>{captured={requestPath,body:options.body,timeoutSeconds:options.timeoutSeconds};return{ok:true,body:{data:[{url:"https://example.com/result.mp4"}]}}}});
const oversizedReference=path.join(gatewayRoot,"oversized-reference.mp4");const oversizedHandle=fs.openSync(oversizedReference,"w");fs.ftruncateSync(oversizedHandle,truth.inlineReferenceLimitBytes+1);fs.closeSync(oversizedHandle);
let oversizedError="";try{gateway.referencePayload([{id:"large",name:"超大参考视频.mp4",type:"video",mime:"video/mp4",path:oversizedReference}])}catch(error){oversizedError=String(error.message||error)}
check("超大参考素材阻止内联避免内存溢出",oversizedError.includes("超过 32MB")&&oversizedError.includes("专用上传适配器"),oversizedError);
const provider=gateway.createProvider({name:"测试模型",protocol:"custom-json",baseUrl:"https://example.com",apiKey:"test"});
gateway.addModel(provider.id,{id:"video-model",parameters:{guidance:7},capabilities:{type:"video",modes:["image-to-video"],ratios:["16:9"],resolutions:["1080p"],durations:["10s"],confirmed:true}});
(async()=>{
  const asset=workbench.resolveAsset(importedImage.id);
  const result=await gateway.generate(provider.id,"video-model",{prompt:"参考素材生成视频",parameters:{duration:"10s"},assets:[asset]});
  check("模型网关提交参考素材",Boolean(captured?.body?.references?.length&&captured.body.reference_images?.length),JSON.stringify(captured?.body||{}).slice(0,800));
  check("模型网关合并默认参数",captured?.body?.guidance===7&&captured?.body?.seconds===10&&!('duration' in (captured?.body||{})),JSON.stringify(captured?.body||{}).slice(0,500));
  check("视频生成至少保留300秒响应窗口",captured?.timeoutSeconds===300,String(captured?.timeoutSeconds));
  check("模型结果地址可解析",result.type==="video"&&result.urls[0]==="https://example.com/result.mp4",JSON.stringify(result));
  const output={at:new Date().toISOString(),reference:path.relative(root,referencePath),passed:results.filter(item=>item.passed).length,failed:results.filter(item=>!item.passed).length,results};
  fs.writeFileSync(path.join(logDirectory,"infinite-canvas-media-model-v2.json"),JSON.stringify(output,null,2),"utf8");
  console.log(JSON.stringify(output,null,2));if(output.failed)process.exitCode=1;
})().catch(error=>{console.error(error);process.exit(1)});
