"use strict";
const assert=require("assert");
const fs=require("fs");
const os=require("os");
const path=require("path");
const {WorkbenchDataBridge}=require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator}=require("../src/main/generation-orchestrator.cjs");
const {ModelGatewayBridge}=require("../src/main/model-gateway-bridge.cjs");
const referencePath=path.join(__dirname,"../references/home-production-pipeline-ground-truth.json");
const truth=JSON.parse(fs.readFileSync(referencePath,"utf8"));
const generatedReference={...truth,generatedAt:new Date().toISOString(),validation:"exact-text-and-material-asset"};
fs.writeFileSync(referencePath,JSON.stringify(generatedReference,null,2)+"\n","utf8");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"lingframe-home-production-"));
const tenantRoot=path.join(root,truth.tenantId);
const tasks=new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const project=tasks.bootstrap().projects[0];
const statuses=[];
const modelGateway={generate:async(providerId,modelId)=>({ok:true,type:"text",providerId,modelId,content:truth.generatedStoryboard,urls:[]})};
const orchestrator=new GenerationOrchestrator({tenantIdProvider:()=>truth.tenantId,tasks,modelGateway,agentBridge:{browser:{}},dataRootProvider:()=>tenantRoot,liveStatusProvider:value=>statuses.push(value)});
const results=[];
const check=async(name,fn)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String(error.stack||error)});}};
const waitFor=async(predicate,timeout=3000)=>{const started=Date.now();while(Date.now()-started<timeout){const value=predicate();if(value)return value;await new Promise(resolve=>setTimeout(resolve,20));}throw new Error("等待任务完成超时");};
(async()=>{
  await check("文本模型结果以素材形式完成回填",async()=>{
    const task=await orchestrator.create({projectId:project.id,title:truth.scriptTitle,prompt:truth.scriptPrompt,creationType:"text",creationSource:"home",executionChannel:"model-gateway",providerId:"provider-gpt",modelId:"gpt-text"});
    const completed=await waitFor(()=>tasks.bootstrap().tasks.find(item=>item.id===task.id&&item.state==="completed"));
    assert.equal(completed.resultType,"text");assert.equal(completed.resultText,truth.generatedStoryboard);assert(completed.resultAssetId);
    const asset=tasks.bootstrap().assets.find(item=>item.id===completed.resultAssetId);assert(asset);assert.equal(asset.type,"text");assert(asset.originalName.endsWith(".txt"));assert.equal(asset.source,"model-gateway-generation");
    const full=tasks.resolveAsset(asset.id);assert.equal(fs.readFileSync(full.path,"utf8"),truth.generatedStoryboard);
  });
  await check("实时状态包含首页结果回填字段",()=>{const completed=statuses.find(item=>item.state==="completed");assert(completed);assert.equal(completed.creationSource,"home");assert.equal(completed.resultType,"text");assert.equal(completed.resultText,truth.generatedStoryboard);assert(completed.resultAssetId);});
  await check("创作首页支持真实任务对话与素材来源选择",()=>{const home=fs.readFileSync(path.join(__dirname,"../src/renderer/home-conversations.js"),"utf8");const fixes=fs.readFileSync(path.join(__dirname,"../src/renderer/app-fixes.js"),"utf8");for(const marker of truth.requiredHomeMarkers)assert(home.includes(marker)||fixes.includes(marker),marker);assert(!home.includes("任务仍按原有链路提交"));assert(fixes.includes("showAssetSourceChooser(assetAdd.closest('.composer')"));assert(fixes.includes("window.LingframeAssetPicker={open:openAssetPicker}"));});
  await check("创作首页与无限画布共用统一生成通道",()=>{const fixes=fs.readFileSync(path.join(__dirname,"../src/renderer/app-fixes.js"),"utf8");const canvas=fs.readFileSync(path.join(__dirname,"../src/renderer/infinite-canvas.js"),"utf8");assert(fixes.includes("api.generation.create(input)"));assert(/api\.generation\.create\(\s*(?:\{|request\s*\))/.test(canvas));});
  await check("实时任务坞限制在右侧栏且保留交互",()=>{const ui=fs.readFileSync(path.join(__dirname,"../src/renderer/generation-ui.js"),"utf8");const css=fs.readFileSync(path.join(__dirname,"../src/renderer/styles/generation-ui.css"),"utf8");assert(ui.includes(".shell:not(.right-off)"));assert(ui.includes(".right"));assert(ui.includes("getBoundingClientRect()"));assert(/shell\.style\.left=`\$\{Math\.round\(rect\.left\+(?:8|inset)\)\}px`/.test(ui));assert(/shell\.style\.width=`\$\{Math\.max\(208,Math\.round\(rect\.width-(?:16|inset\*2)\)\)\}px`/.test(ui));assert(css.includes(".generation-live-dock")&&css.includes("pointer-events:auto"));assert(css.includes(".generation-live-detail")&&css.includes("pointer-events:auto"));assert(ui.includes("canOpenWindow(item)"));});
  await check("图片参考素材始终按数组提交",async()=>{const gatewayRoot=path.join(root,"gateway-array-test");let submittedBody=null;const gateway=new ModelGatewayBridge({tenantRootProvider:()=>gatewayRoot,requestJson:async(_provider,_path,options)=>{submittedBody=options.body;return{ok:true,body:{data:[{url:"https://result.test/reference.png"}]}};}});const provider=gateway.createProvider({name:"测试图片厂商",baseUrl:"https://gateway.test",protocol:"openai-compatible"});gateway.addModel(provider.id,{id:"image-array-test",displayName:"图片数组测试",capabilities:{type:"image"}});const imagePath=path.join(gatewayRoot,"reference.png");fs.mkdirSync(gatewayRoot,{recursive:true});fs.writeFileSync(imagePath,Buffer.from([1,2,3,4]));await gateway.generate(provider.id,"image-array-test",{prompt:"参考图测试",assets:[{id:"asset-a",name:"人物参考",type:"image",mime:"image/png",path:imagePath}]});assert(Array.isArray(submittedBody.image));assert.equal(submittedBody.image.length,1);assert.deepStrictEqual(submittedBody.image,submittedBody.images);assert.deepStrictEqual(submittedBody.image,submittedBody.reference_images);});
  const failed=results.filter(item=>!item.ok);const logDir=path.join(__dirname,"log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"home-production-pipeline.json"),JSON.stringify({test:"home-production-pipeline",total:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2),"utf8");console.log(`HOME_PRODUCTION_PIPELINE ${results.length-failed.length}/${results.length}`);if(failed.length){for(const item of failed)console.error(item.name,item.error);process.exit(1);}
})();
