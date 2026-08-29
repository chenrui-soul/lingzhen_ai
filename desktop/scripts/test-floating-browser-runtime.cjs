"use strict";
const assert = require("assert");
const {EventEmitter} = require("events");
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "embedded-browser-ground-truth.json"), "utf8"));
const {EmbeddedBrowserManager, SAFE_WINDOW} = require(path.join(root, "src", "main", "embedded-browser-manager.cjs"));

class MockWebContents extends EventEmitter {
  constructor() { super(); this.url="";this.destroyed=false;this.loading=false;this.session={cookies:{get:async()=>[]}}; }
  setWindowOpenHandler(handler) { this.windowOpenHandler=handler; }
  getURL() { return this.url; }
  async loadURL(url) { this.url=url;this.loading=false;this.emit("did-finish-load"); }
  isLoading() { return this.loading; }
  isDestroyed() { return this.destroyed; }
  async executeJavaScript() { return {loggedIn:true,platformAccountName:"mock",verificationRequired:false}; }
}
class MockWindow extends EventEmitter {
  constructor(options) { super();this.options=options;this.webContents=new MockWebContents();this.destroyed=false;this.visible=false;this.minimized=false;this.bounds={x:options.x,y:options.y,width:options.width,height:options.height};this.title=options.title;this.flash=false; }
  isDestroyed(){return this.destroyed} getBounds(){return {...this.bounds}} getSize(){return [this.bounds.width,this.bounds.height]}
  setSize(width,height){this.bounds.width=width;this.bounds.height=height} setTitle(value){this.title=value} setMenuBarVisibility(){}
  isVisible(){return this.visible} isMinimized(){return this.minimized} show(){this.visible=true;this.emit("show")} showInactive(){this.visible=true;this.emit("show")} focus(){this.focused=true}
  hide(){this.visible=false;this.emit("hide")} restore(){this.minimized=false;this.emit("restore")} flashFrame(value){this.flash=value}
  destroy(){this.destroyed=true;this.webContents.destroyed=true;this.emit("closed")}
}
const mainWindow={isDestroyed:()=>false,getBounds:()=>({x:100,y:80,width:1440,height:900}),webContents:{send:()=>{}}};
const windows=[];
const manager=new EmbeddedBrowserManager({window:mainWindow,tenantProvider:()=>truth.tenantId,dataRootProvider:()=>path.join(root,"scripts","tmp","floating-browser-runtime"),browserWindowFactory:options=>{const win=new MockWindow(options);windows.push(win);return win}});
const checks=[];const check=(name,fn)=>{try{fn();checks.push({name,ok:true})}catch(error){checks.push({name,ok:false,error:String(error.message||error)})}};
(async()=>{
  const accountA=truth.accounts[0],accountB=truth.accounts[1];
  const runtimeA=await manager.beginTask(accountA,{id:"task-a",accountId:accountA.id,state:"preparing",statusText:"正在准备"});
  const runtimeB=await manager.beginTask(accountB,{id:"task-b",accountId:accountB.id,state:"preparing",statusText:"正在准备"});
  check("two accounts own two windows",()=>assert.equal(windows.length,2));
  check("automation windows stay hidden behind the workbench",()=>assert(!windows[0].visible&&!windows[1].visible));
  check("partitions are isolated",()=>assert.notEqual(runtimeA.current.partition,runtimeB.current.partition));
  check("safe viewport matches ground truth",()=>{assert.equal(SAFE_WINDOW.width,truth.safeWindow.width);assert.equal(SAFE_WINDOW.minHeight,truth.safeWindow.minHeight)});
  check("background throttling disabled",()=>assert(windows.every(win=>win.options.webPreferences.backgroundThrottling===false)));
  const reused=await manager.automationSession(accountA);
  check("same account reuses webContents",()=>assert.strictEqual(reused.webContents,windows[0].webContents));
  const before={...windows[0].bounds};const ignored=manager.setBounds({x:1,y:1,width:200,height:100});
  check("main layout bounds are ignored",()=>{assert.equal(ignored.ignored,true);assert.deepEqual(windows[0].bounds,before)});
  let prevented=false;windows[0].emit("close",{preventDefault:()=>{prevented=true}});
  check("running close hides instead of destroys",()=>{assert.equal(prevented,true);assert.equal(windows[0].visible,false);assert.equal(windows[0].destroyed,false)});
  check("other account remains hidden and unaffected",()=>assert.equal(windows[1].visible,false));
  manager.updateTask({id:"task-a",taskId:"task-a",accountId:accountA.id,state:"completed",statusText:"完成"});
  let preventedAfter=false;windows[0].emit("close",{preventDefault:()=>{preventedAfter=true}});
  check("idle close is no longer protected",()=>assert.equal(preventedAfter,false));
  const status=manager.status();
  check("status reports both account runtimes",()=>assert.equal(status.accounts.length,2));
  let releaseLoad;const loadGate=new Promise(resolve=>{releaseLoad=resolve});const raceWindows=[];
  const raceManager=new EmbeddedBrowserManager({window:mainWindow,tenantProvider:()=>truth.tenantId,dataRootProvider:()=>path.join(root,"scripts","tmp","floating-browser-runtime-race"),browserWindowFactory:options=>{const win=new MockWindow(options);win.webContents.loadURL=async url=>{win.webContents.url=url;await loadGate;win.webContents.loading=false;win.webContents.emit("did-finish-load")};raceWindows.push(win);return win}});
  const raceAccount={id:"account-race",name:"竞态测试账号",platform:"豆包"};const staleOpen=raceManager.open(raceAccount);await Promise.resolve();await raceManager.beginTask(raceAccount,{id:"task-race",accountId:raceAccount.id,state:"preparing",statusText:"正在准备"});releaseLoad();const staleOpenResult=await staleOpen;
  check("stale account open cannot cover a newly started task",()=>{assert.equal(raceWindows[0].visible,false);assert.equal(staleOpenResult.current.activeTaskIds.includes("task-race"),true)});
  raceManager.dispose();
  manager.dispose();
  check("dispose destroys all windows",()=>assert(windows.every(win=>win.destroyed)));
  const failed=checks.filter(item=>!item.ok);const report={test:"floating-browser-runtime",timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
  const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"floating-browser-runtime.json"),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(failed.length)process.exitCode=1;
})().catch(error=>{console.error(error);process.exitCode=1});
