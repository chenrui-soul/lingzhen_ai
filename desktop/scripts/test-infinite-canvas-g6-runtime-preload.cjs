"use strict";

const {contextBridge} = require("electron");

const copy = value => JSON.parse(JSON.stringify(value ?? null));
const ok = value => Promise.resolve(copy(value));
const noop = () => ok(null);
const project = {id:"project-canvas-g6", name:"无限画布 G6 隔离测试"};
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const assets = [{id:"asset-result-g6", projectId:project.id, type:"image", name:"G6 回填结果.png", originalName:"g6-result.png", size:2048, contentUrl:pixel}];
const tasks = [{
  id:"task-running-g6", projectId:project.id, title:"G6 原画布运行任务", creationSource:"infinite-canvas-v2",
  creationType:"image", executionChannel:"model-gateway", providerId:"provider-g6", modelId:"image-g6",
  state:"generating", statusText:"生成中", progressMode:"indeterminate", progress:52, resultAssetId:"", createdAt:new Date().toISOString()
}];
const listeners = {liveStatus:[]};
const calls = {generationCancel:0, taskCancel:0, generationCreate:0};
const providers = [{id:"provider-g6", name:"G6 测试模型", models:[
  {id:"text-g6", displayName:"文本模型", enabled:true, parameters:{temperature:.7}, capabilities:{type:"text", confirmed:true}},
  {id:"image-g6", displayName:"图片模型", enabled:true, parameters:{count:1}, capabilities:{type:"image", confirmed:true, ratios:["1:1","16:9"], maxReferenceImages:4}},
  {id:"video-g6", displayName:"视频模型", enabled:true, parameters:{count:1}, capabilities:{type:"video", confirmed:true, ratios:["16:9"], durations:["10s"], maxReferenceImages:4}}
]}];

contextBridge.exposeInMainWorld("lingframe", {
  window:{minimize:noop, toggleMaximize:noop, close:noop, isMaximized:()=>ok(false)},
  app:{diagnostics:()=>ok({test:"infinite-canvas-g6"}), openExternal:noop},
  connection:{status:()=>ok({connected:true, baseUrl:"http://127.0.0.1/g6-test"}), refresh:()=>ok({connected:true})},
  identity:{status:()=>ok({tenantId:"tenant-canvas-g6", usable:true, source:"g6-runtime"})},
  license:{status:()=>ok({usable:true, deviceSuffix:"G6"}), activate:noop, refresh:()=>ok({usable:true}), clear:noop},
  agent:{status:()=>ok({online:true, configured:true, agentId:"agent-g6"}), configure:noop, openAccount:noop, detectAccount:()=>ok({loggedIn:true})},
  workbench:{bootstrap:()=>ok({currentProjectId:project.id, projects:[project], assets, textConversations:[], tasks})},
  models:{bootstrap:()=>ok(providers), createProvider:noop, updateProvider:noop, deleteProvider:noop, testProvider:noop, discover:()=>ok([]), addModel:noop, updateModel:noop, deleteModel:noop},
  projects:{create:()=>ok(project), update:()=>ok(project), setCurrent:()=>ok(project), delete:noop, restore:()=>ok(project)},
  assets:{list:()=>ok(assets), pickImport:()=>ok([]), import:()=>ok([]), copy:()=>ok({assets:[], copiedCount:0}), preview:id=>ok(assets.find(item=>item.id===id)), update:noop, delete:noop, restore:noop, open:noop, showInFolder:noop, readText:()=>ok({content:""})},
  text:{create:()=>ok({id:"conversation-g6", projectId:project.id, title:"G6", type:"画布节点", content:"", versions:[]}), update:noop, delete:noop, restore:noop, restoreVersion:noop, deleteVersion:noop},
  tasks:{create:noop, report:noop, complete:noop, updateResultUrl:noop, cancel:()=>{calls.taskCancel+=1;return ok(null);}, retry:noop, archive:noop, delete:noop, restore:noop},
  generation:{
    create:input=>{calls.generationCreate+=1;return ok({id:`task-created-g6-${calls.generationCreate}`, ...copy(input), state:"queued"});},
    run:noop, resume:noop, monitor:noop, cancel:()=>{calls.generationCancel+=1;return ok(null);},
    onLiveView:noop,
    onLiveStatus:callback=>{if(typeof callback==="function")listeners.liveStatus.push(callback);}
  },
  doubao:{open:noop, detect:()=>ok({loggedIn:true}), close:noop, popout:noop, activateAccount:noop, setBounds:noop, setPageActive:noop, status:()=>ok({}), onStatus:noop}
});

contextBridge.exposeInMainWorld("__lingframeG6", {
  calls:()=>copy(calls),
  completeRunningTask:()=>{
    const task=tasks.find(item=>item.id==="task-running-g6");
    Object.assign(task,{state:"completed", statusText:"已完成", progressMode:"determinate", progress:100, resultAssetId:"asset-result-g6"});
    for(const callback of listeners.liveStatus)callback(copy({taskId:task.id, state:task.state, progress:task.progress, resultAssetId:task.resultAssetId}));
    return copy(task);
  }
});
