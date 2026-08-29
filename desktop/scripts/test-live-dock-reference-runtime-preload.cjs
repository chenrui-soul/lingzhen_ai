"use strict";

const {contextBridge}=require("electron");
const ok=value=>Promise.resolve(JSON.parse(JSON.stringify(value??null)));const noop=()=>ok(null);
const project={id:"project-live-reference-test",name:"任务坞与参考图测试"};const liveStatusCallbacks=new Set();let lastGenerationInput=null;
const pixel="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=";
const imported=[
  {id:"asset-prop",projectId:project.id,type:"image",name:"黑伞道具图",originalName:"prop.png",size:2048,tags:["道具"],notes:"",contentUrl:pixel},
  {id:"asset-character",projectId:project.id,type:"image",name:"年轻男人角色图",originalName:"character.png",size:2048,tags:["人物"],notes:"",contentUrl:pixel},
  {id:"asset-scene",projectId:project.id,type:"image",name:"雨夜便利店场景图",originalName:"scene.png",size:2048,tags:["场景"],notes:"",contentUrl:pixel}
];

contextBridge.exposeInMainWorld("lingframe",{
  window:{minimize:noop,toggleMaximize:noop,close:noop,isMaximized:()=>ok(false)},app:{diagnostics:()=>ok({test:true}),openExternal:noop},identity:{status:()=>ok({tenantId:"tenant-live-reference-test",usable:true,source:"verified-agent"})},license:{status:()=>ok({usable:true,deviceSuffix:"TEST"}),activate:noop,refresh:()=>ok({usable:true}),clear:noop},agent:{status:()=>ok({online:true,deviceName:"test",agentId:"agent-test"}),configure:noop,openAccount:noop,detectAccount:noop},
  workbench:{bootstrap:()=>ok({currentProjectId:project.id,projects:[project],assets:imported,texts:[],tasks:[]})},models:{bootstrap:()=>ok([]),createProvider:noop,updateProvider:noop,deleteProvider:noop,testProvider:noop,discover:()=>ok([]),addModel:noop,updateModel:noop,deleteModel:noop},projects:{create:noop,update:noop,setCurrent:noop,delete:noop,restore:noop},assets:{list:()=>ok(imported),pickImport:()=>ok(imported),import:()=>ok(imported),copy:input=>ok({assets:imported.filter(item=>(input.assetIds||[]).includes(item.id)),copiedCount:0}),preview:id=>ok({...imported.find(item=>item.id===id),previewType:"image"}),update:noop,delete:noop,restore:noop,open:noop,showInFolder:noop,readText:()=>ok({content:""})},text:{create:noop,update:noop,delete:noop,restore:noop,restoreVersion:noop,deleteVersion:noop},tasks:{create:noop,report:noop,complete:noop,updateResultUrl:noop,cancel:noop,retry:noop,archive:noop,delete:noop,restore:noop},
  generation:{create:input=>{lastGenerationInput=JSON.parse(JSON.stringify(input));return ok({id:"runtime-task",title:input.title,...input,state:"queued"})},run:noop,resume:noop,monitor:noop,cancel:noop,onLiveView:()=>{},onLiveStatus:callback=>{if(typeof callback==="function")liveStatusCallbacks.add(callback)}},doubao:{open:noop,detect:noop,close:noop,popout:noop,activateAccount:noop,setBounds:noop,setPageActive:noop,status:()=>ok({}),onStatus:()=>{}}
});
contextBridge.exposeInMainWorld("__lingframeTest",{hasLiveStatusCallback:()=>liveStatusCallbacks.size>0,liveStatusCallbackCount:()=>liveStatusCallbacks.size,emitLiveStatus:payload=>{const value=JSON.parse(JSON.stringify(payload));for(const callback of liveStatusCallbacks)callback(value)},lastGenerationInput:()=>JSON.parse(JSON.stringify(lastGenerationInput))});
