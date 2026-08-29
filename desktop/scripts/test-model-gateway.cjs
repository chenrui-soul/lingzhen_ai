"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {ModelGatewayBridge, inferCapabilities, endpointUrl, PROTOCOLS} = require("../src/main/model-gateway-bridge.cjs");

const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "../references/model-gateway-ground-truth.json"), "utf8"));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-model-gateway-"));
const logFile = path.join(__dirname, "log/model-gateway.json");
const results = [];
function test(name, fn) { return Promise.resolve().then(fn).then(() => results.push({name, ok:true})).catch(error => { results.push({name, ok:false, error:error.stack || String(error)}); }); }
const tenantA = path.join(root, "tenant-a"), tenantB = path.join(root, "tenant-b");
const requests = [];
const requestJson = async (provider, requestPath) => { requests.push({provider: provider.id, requestPath}); if (provider.name === "失败厂商") return {ok:false,error:"mock unauthorized"}; return {ok:true,body:{data:truth.discoveredModels.map(id => ({id}))}}; };
const bridgeA = new ModelGatewayBridge({tenantRootProvider:()=>tenantA,secretProvider:()=>"tenant-a|device-a",requestJson});
const bridgeB = new ModelGatewayBridge({tenantRootProvider:()=>tenantB,secretProvider:()=>"tenant-b|device-b",requestJson});
let providerA;
(async()=>{
  await test("协议白名单与 Ground Truth 一致",()=>assert.deepStrictEqual([...PROTOCOLS],truth.protocols));
  await test("Base URL 与路径中的 v1 不会重复",()=>{assert.equal(endpointUrl("https://api.example.com/v1","/v1/models"),"https://api.example.com/v1/models");assert.equal(endpointUrl("https://api.example.com","/v1/models"),"https://api.example.com/v1/models");});
  await test("图片和视频生成使用更长的安全超时",async()=>{const timeoutRoot=path.join(root,"timeout-provider"),captured=[];const timeoutBridge=new ModelGatewayBridge({tenantRootProvider:()=>timeoutRoot,secretProvider:()=>"timeout",requestJson:async(_provider,_path,options)=>{captured.push(options.timeoutSeconds);return{ok:true,body:{data:[{url:"https://example.com/result"}]}}}});const provider=timeoutBridge.createProvider({name:"超时测试",protocol:"custom-json",baseUrl:"https://api.example.com",timeoutSeconds:60});timeoutBridge.addModel(provider.id,{id:"image-model",capabilities:{type:"image"}});timeoutBridge.addModel(provider.id,{id:"video-model",capabilities:{type:"video"}});await timeoutBridge.generate(provider.id,"image-model",{prompt:"image"});await timeoutBridge.generate(provider.id,"video-model",{prompt:"video"});assert.deepStrictEqual(captured,[180,300]);});
  await test("创建厂商并返回掩码，不返回明文",()=>{ providerA=bridgeA.createProvider({name:"测试厂商",protocol:"openai-compatible",baseUrl:"https://api.example.com",apiKey:truth.secret,customHeaders:{"X-Secret":truth.headerSecret},concurrency:3,timeoutSeconds:45}); assert.equal(providerA.hasApiKey,true);assert.equal(providerA.apiKeyMask,"••••••••");assert(!("apiKey" in providerA));assert.deepStrictEqual(providerA.customHeaderNames,["X-Secret"]); });
  await test("普通配置 JSON 不包含 API Key 或请求头值",()=>{const raw=fs.readFileSync(path.join(tenantA,"database/model-gateway-v1.json"),"utf8");assert(!raw.includes(truth.secret));assert(!raw.includes(truth.headerSecret));assert(raw.includes("X-Secret"));});
  await test("加密文件不包含明文",()=>{const raw=fs.readFileSync(path.join(tenantA,"database/model-provider-secrets-v1.json"),"utf8");assert(!raw.includes(truth.secret));assert(!raw.includes(truth.headerSecret));assert(raw.includes('"iv"'));assert(raw.includes('"tag"'));});
  await test("更新厂商保留未回填密钥",()=>{const updated=bridgeA.updateProvider(providerA.id,{name:"厂商已更新",baseUrl:"https://api.example.com/v2",enabled:false});assert.equal(updated.name,"厂商已更新");assert.equal(updated.enabled,false);assert.equal(updated.hasApiKey,true);});
  await test("手动添加文本模型",()=>{const value=bridgeA.addModel(providerA.id,{id:"gpt-5.2",displayName:"GPT 5.2",parameters:{temperature:0.7}});assert.equal(value.models[0].capabilities.type,"text");assert.equal(value.models[0].parameters.temperature,0.7);});
  await test("手动添加图片模型自动识别能力",()=>assert.equal(bridgeA.addModel(providerA.id,{id:"flux-image-pro"}).models.at(-1).capabilities.type,"image"));
  await test("手动添加视频模型自动识别能力",()=>assert.equal(bridgeA.addModel(providerA.id,{id:"seedance-video-pro"}).models.at(-1).capabilities.type,"video"));
  await test("手动添加音频模型自动识别能力",()=>assert.equal(bridgeA.addModel(providerA.id,{id:"voice-tts-pro"}).models.at(-1).capabilities.type,"audio"));
  await test("更新模型启停与参数",()=>{const value=bridgeA.updateModel(providerA.id,"gpt-5.2",{enabled:false,parameters:{max_tokens:2048}});const model=value.models.find(item=>item.id==="gpt-5.2");assert.equal(model.enabled,false);assert.equal(model.parameters.max_tokens,2048);});
  await test("删除模型",()=>{const value=bridgeA.deleteModel(providerA.id,"voice-tts-pro");assert(!value.models.some(item=>item.id==="voice-tts-pro"));});
  await test("自动发现真实列表结构并推断四类能力，同时保留手动模型",async()=>{const value=await bridgeA.discoverModels(providerA.id);for(const [modelId,expectedType] of Object.entries(truth.expectedTypes)){const model=value.models.find(item=>item.id===modelId);assert(model,`缺少自动发现模型 ${modelId}`);assert.equal(model.capabilities.type,expectedType);}assert(value.models.some(item=>item.id==="gpt-5.2"),"自动获取不应删除手动模型");});
  await test("连接测试成功状态持久化",async()=>{const result=await bridgeA.testProvider(providerA.id);assert.equal(result.ok,true);assert.equal(result.provider.status,"online");assert(result.provider.lastTestedAt);});
  await test("连接测试失败状态持久化",async()=>{const failed=bridgeA.createProvider({name:"失败厂商",protocol:"custom-json",baseUrl:"https://bad.example.com"});const result=await bridgeA.testProvider(failed.id);assert.equal(result.ok,false);assert.equal(result.provider.status,"error");assert.equal(result.statusText,"mock unauthorized");});
  await test("租户 B 看不到租户 A 厂商",()=>assert.deepStrictEqual(bridgeB.bootstrap(),[]));
  await test("同一密钥在不同租户生成不同密文",()=>{bridgeB.createProvider({name:"B",protocol:"openai-compatible",baseUrl:"https://api.example.com",apiKey:truth.secret,customHeaders:{"X-Secret":truth.headerSecret}});const a=fs.readFileSync(path.join(tenantA,"database/model-provider-secrets-v1.json"),"utf8"),b=fs.readFileSync(path.join(tenantB,"database/model-provider-secrets-v1.json"),"utf8");assert.notEqual(a,b);});
  await test("非 HTTP/HTTPS URL 全部拒绝",()=>{for(const url of truth.invalidUrls)assert.throws(()=>bridgeA.createProvider({name:"invalid",protocol:"openai-compatible",baseUrl:url}),/HTTP\/HTTPS/);});
  await test("重复模型被拒绝",()=>assert.throws(()=>bridgeA.addModel(providerA.id,{id:"gpt-5.2"}),/已存在/));
  await test("删除厂商同步清除加密条目",()=>{const target=bridgeA.bootstrap().find(item=>item.name==="失败厂商");bridgeA.updateProvider(target.id,{apiKey:"delete-me"});bridgeA.deleteProvider(target.id);const secrets=JSON.parse(fs.readFileSync(path.join(tenantA,"database/model-provider-secrets-v1.json"),"utf8"));assert(!secrets.entries[target.id]);});
  await test("公开 bootstrap 从不返回密钥字段",()=>{for(const provider of bridgeA.bootstrap()){assert(!("apiKey" in provider));assert(!("customHeaders" in provider));}});
  await test("请求只走注入适配器且模型路径正确",()=>assert(requests.some(item=>item.requestPath==="/v1/models")));
  await test("系统设置 UI 资源与受控 API 已接入",()=>{const html=fs.readFileSync(path.join(__dirname,"../src/renderer/index.html"),"utf8"),ui=fs.readFileSync(path.join(__dirname,"../src/renderer/model-gateway.js"),"utf8"),preload=fs.readFileSync(path.join(__dirname,"../src/preload/preload.cjs"),"utf8"),main=fs.readFileSync(path.join(__dirname,"../src/main/main.cjs"),"utf8");assert(html.includes("model-gateway.css")&&html.includes("model-gateway.js"));assert(ui.includes("自定义模型网关"));assert(preload.includes("models:create-provider"));assert(main.includes("models:discover"));});
  const failed=results.filter(item=>!item.ok);fs.mkdirSync(path.dirname(logFile),{recursive:true});fs.writeFileSync(logFile,JSON.stringify({at:new Date().toISOString(),total:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2),"utf8");console.log(`MODEL_GATEWAY_TESTS ${results.length-failed.length}/${results.length}`);if(failed.length){for(const item of failed)console.error(item.name,item.error);process.exitCode=1;}
})();
