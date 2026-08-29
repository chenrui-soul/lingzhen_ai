"use strict";

const {contextBridge} = require("electron");

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const ok = value => Promise.resolve(copy(value));
const noop = () => ok(null);
const project = {id:"project-canvas-g5", name:"无限画布 G5 隔离测试"};
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const assets = [
  {id:"asset-image-g5", projectId:project.id, type:"image", name:"角色参考图.png", originalName:"character.png", size:2048, contentUrl:pixel},
  {id:"asset-video-g5", projectId:project.id, type:"video", name:"动作参考.mp4", originalName:"motion.mp4", size:4096, contentUrl:"data:video/mp4;base64,AAAA"},
  {id:"asset-audio-g5", projectId:project.id, type:"audio", name:"旁白参考.mp3", originalName:"voice.mp3", mimeType:"audio/mpeg", size:4096, contentUrl:"data:audio/mpeg;base64,AAAA"}
];
const tasks = [{
  id:"task-running-g5", projectId:project.id, title:"已经执行的视频任务", creationSource:"infinite-canvas-v2",
  creationType:"video", executionChannel:"doubao", accountId:"desktop-g5", accountName:"G5 测试账号",
  state:"generating", statusText:"豆包生成中", progressMode:"indeterminate", progress:45, createdAt:new Date().toISOString()
}];
const listeners = {liveStatus:[], liveView:[], doubao:[]};
const calls = {generationCancel:0, taskCancel:0, generationCreate:0};
let lastGenerationInput = null;

const providers = [{id:"provider-g5", name:"G5 测试模型", models:[
  {id:"text-g5", displayName:"文本模型", enabled:true, parameters:{temperature:.7}, capabilities:{type:"text", confirmed:true}},
  {id:"image-g5", displayName:"图片模型", enabled:true, parameters:{count:1}, capabilities:{type:"image", confirmed:true, modes:["text-to-image","image-to-image"], ratios:["1:1","16:9","9:16"], resolutions:["1024p"], maxReferenceImages:4}},
  {id:"video-g5", displayName:"视频模型", enabled:true, parameters:{count:1}, capabilities:{type:"video", confirmed:true, modes:["text-to-video","image-to-video"], ratios:["16:9","9:16"], resolutions:["720p","1080p"], durations:["5s","10s"], maxReferenceImages:4}},
  {id:"audio-g5", displayName:"音频模型", enabled:true, parameters:{count:1}, capabilities:{type:"audio", confirmed:true, durations:["15s","30s"]}}
]}];

contextBridge.exposeInMainWorld("lingframe", {
  window:{minimize:noop, toggleMaximize:noop, close:noop, isMaximized:()=>ok(false)},
  app:{diagnostics:()=>ok({test:"infinite-canvas-g5"}), openExternal:noop},
  connection:{status:()=>ok({connected:true, baseUrl:"http://127.0.0.1/g5-test"}), refresh:()=>ok({connected:true, baseUrl:"http://127.0.0.1/g5-test"})},
  identity:{status:()=>ok({tenantId:"tenant-canvas-g5", usable:true, source:"g5-runtime"})},
  license:{status:()=>ok({usable:true, deviceSuffix:"G5"}), activate:noop, refresh:()=>ok({usable:true}), clear:noop},
  agent:{status:()=>ok({online:true, configured:true, agentId:"agent-g5"}), configure:noop, openAccount:noop, detectAccount:()=>ok({loggedIn:true})},
  workbench:{bootstrap:()=>ok({currentProjectId:project.id, projects:[project], assets, textConversations:[], tasks})},
  models:{bootstrap:()=>ok(providers), createProvider:noop, updateProvider:noop, deleteProvider:noop, testProvider:noop, discover:()=>ok([]), addModel:noop, updateModel:noop, deleteModel:noop},
  projects:{create:()=>ok(project), update:()=>ok(project), setCurrent:()=>ok(project), delete:noop, restore:()=>ok(project)},
  assets:{list:()=>ok(assets), pickImport:()=>ok([]), import:()=>ok([]), copy:input=>ok({assets:assets.filter(item=>(input?.assetIds||[]).includes(item.id)), copiedCount:0}), preview:id=>ok(assets.find(item=>item.id===id)), update:noop, delete:noop, restore:noop, open:noop, showInFolder:noop, readText:()=>ok({content:""})},
  text:{create:input=>ok({id:"conversation-g5", projectId:project.id, title:input?.title||"G5", type:input?.type||"general", content:"", versions:[]}), update:noop, delete:noop, restore:noop, restoreVersion:noop, deleteVersion:noop},
  tasks:{create:noop, report:noop, complete:noop, updateResultUrl:noop, cancel:()=>{calls.taskCancel+=1;return ok(null);}, retry:noop, archive:noop, delete:noop, restore:noop},
  generation:{
    create:input=>{calls.generationCreate+=1;lastGenerationInput=copy(input);return ok({id:`task-created-g5-${calls.generationCreate}`, title:input?.title||"G5", ...copy(input), state:"queued"});},
    run:noop, resume:noop, monitor:noop, cancel:()=>{calls.generationCancel+=1;return ok(null);},
    onLiveView:callback=>{if(typeof callback==="function")listeners.liveView.push(callback);},
    onLiveStatus:callback=>{if(typeof callback==="function")listeners.liveStatus.push(callback);}
  },
  doubao:{open:noop, detect:()=>ok({loggedIn:true}), close:noop, popout:noop, activateAccount:noop, setBounds:noop, setPageActive:noop, status:()=>ok({}), onStatus:callback=>{if(typeof callback==="function")listeners.doubao.push(callback);}}
});

contextBridge.exposeInMainWorld("__lingframeG5", {
  calls:()=>copy(calls),
  lastGenerationInput:()=>copy(lastGenerationInput),
  emitLiveStatus:payload=>{for(const callback of listeners.liveStatus)callback(copy(payload));}
});
