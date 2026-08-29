"use strict";

const {contextBridge} = require("electron");
const ok = value => Promise.resolve(JSON.parse(JSON.stringify(value ?? null)));
const noop = () => ok(null);
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const project = {id:"project-responsive", name:"响应式验收项目", description:"桌面多尺寸布局验收"};
const assets = [
  {id:"asset-image", projectId:project.id, type:"image", name:"人物参考图", originalName:"portrait.png", size:4096, contentUrl:pixel, tags:["人物"]},
  {id:"asset-video", projectId:project.id, type:"video", name:"雨夜街景视频", originalName:"street.mp4", size:8192, contentUrl:"", tags:["视频"]},
  {id:"asset-text", projectId:project.id, type:"text", name:"分镜提示词", originalName:"prompt.txt", size:1024, contentUrl:"", tags:["文本"]}
];
const tasks = [
  {id:"task-running", title:"雨夜人物视频", projectId:project.id, creationSource:"home", creationType:"video", executionChannel:"doubao", accountName:"白同学", state:"generating", stage:"monitoring", progress:46, createdAt:new Date(Date.now()-300000).toISOString(), updatedAt:new Date().toISOString()},
  {id:"task-waiting", title:"古风角色转身", projectId:project.id, creationSource:"home", creationType:"video", executionChannel:"doubao", accountName:"创作账号二", state:"awaiting_verification", stage:"awaiting_verification", progress:20, createdAt:new Date(Date.now()-240000).toISOString(), updatedAt:new Date().toISOString()},
  {id:"task-complete", title:"城市广告镜头", projectId:project.id, creationSource:"home", creationType:"video", executionChannel:"model-gateway", state:"completed", stage:"completed", progress:100, resultUrls:["https://example.invalid/video.mp4"], createdAt:new Date(Date.now()-180000).toISOString(), updatedAt:new Date().toISOString()}
];
const boot = {currentProjectId:project.id, projects:[project], assets, textConversations:[], tasks, doubaoQuotaBlocks:[]};
const identity = {authenticated:true, workspaceReady:true, usable:true, tenantId:"tenant-responsive", userId:"user-responsive", role:"member", user:{username:"验收用户", email:"responsive@example.com"}, tenant:{displayName:"灵帧创作空间", code:"responsive"}, permissions:["desktop.bootstrap"]};
const authCallbacks = new Set();
const liveCallbacks = new Set();

contextBridge.exposeInMainWorld("lingframe", {
  window:{minimize:noop,toggleMaximize:noop,close:noop,isMaximized:()=>ok(false)},
  app:{diagnostics:()=>ok({test:true}),openExternal:noop},
  updates:{status:()=>ok({state:"idle"}),check:noop,download:noop,install:noop,onStatus:()=>{}},
  connection:{status:()=>ok({connected:true}),refresh:()=>ok({connected:true}),verifyAdmin:noop,adminStatus:noop,applyAdmin:noop},
  identity:{status:()=>ok(identity)},
  auth:{status:()=>ok(identity),bootstrap:()=>ok(identity),login:()=>ok(identity),register:()=>ok(identity),selectTenant:()=>ok(identity),refresh:()=>ok(identity),logout:noop,onChanged:handler=>{if(typeof handler==="function")authCallbacks.add(handler)}},
  license:{status:()=>ok({usable:true,state:"active"}),activate:()=>ok({usable:true,state:"active"}),refresh:()=>ok({usable:true,state:"active"}),clear:noop},
  agent:{status:()=>ok({online:true,deviceName:"响应式验收设备",agentId:"agent-responsive"}),configure:noop,openAccount:noop,detectAccount:noop},
  workbench:{bootstrap:()=>ok(boot)},
  models:{bootstrap:()=>ok([]),createProvider:noop,updateProvider:noop,deleteProvider:noop,testProvider:noop,discover:()=>ok([]),addModel:noop,updateModel:noop,deleteModel:noop},
  projects:{create:noop,update:noop,setCurrent:noop,delete:noop,restore:noop},
  assets:{list:()=>ok(assets),pickImport:()=>ok([]),import:()=>ok([]),createText:noop,copy:()=>ok({assets:[],copiedCount:0}),preview:id=>ok({...assets.find(item=>item.id===id),previewType:assets.find(item=>item.id===id)?.type||"text",content:"响应式测试文本"}),update:noop,delete:noop,restore:noop,open:noop,showInFolder:noop,readText:()=>ok({content:"响应式测试文本"})},
  text:{create:input=>ok({id:"text-responsive",projectId:project.id,title:input?.title||"响应式文档",type:"story",content:"这里是用于桌面布局验收的文本内容。",versions:[]}),update:noop,delete:noop,restore:noop,restoreVersion:noop,deleteVersion:noop},
  tasks:{create:noop,report:noop,complete:noop,updateResultUrl:noop,cancel:noop,retry:noop,archive:noop,delete:noop,restore:noop},
  generation:{create:input=>ok({id:"task-new",...input,state:"queued"}),run:noop,resume:noop,monitor:noop,resolveSubmissionUnknown:noop,pauseModel:noop,resumeModel:noop,retryModelResult:noop,updateModelResult:noop,retryDoubaoResult:noop,cancel:noop,onLiveView:()=>{},onLiveStatus:handler=>{if(typeof handler==="function")liveCallbacks.add(handler)}},
  doubao:{open:noop,detect:noop,close:noop,popout:noop,activateAccount:noop,hideAccount:noop,setBounds:noop,setPageActive:noop,status:()=>ok({visible:false,state:"ready"}),onStatus:()=>{}},
  doubaoAccounts:{bootstrap:()=>ok({tenantId:identity.tenantId,accounts:[{id:"desktop-1",name:"白同学",platform:"豆包",loginState:"logged_in"}],locked:false}),list:()=>ok([{id:"desktop-1",name:"白同学",platform:"豆包",loginState:"logged_in"}]),upsert:noop,remove:noop,discoverLocal:()=>ok([]),importLocal:noop}
});

contextBridge.exposeInMainWorld("__responsiveTest", {emitLive:payload=>{for(const callback of liveCallbacks)callback(JSON.parse(JSON.stringify(payload)))}});
