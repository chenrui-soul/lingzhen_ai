"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9334);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop_v1/src/renderer");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async()=>{
  const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
  if (!target) throw new Error("未找到截图目标页面");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let sequence=0;
  const send=(method,params={})=>new Promise((resolve,reject)=>{
    const id=++sequence;
    const handler=event=>{const message=JSON.parse(String(event.data));if(message.id!==id)return;socket.removeEventListener("message",handler);if(message.error)reject(new Error(message.error.message));else resolve(message.result||{})};
    socket.addEventListener("message",handler);
    socket.send(JSON.stringify({id,method,params}));
  });
  const evaluate=async expression=>(await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true})).result?.value;
  const saved=await evaluate("localStorage.getItem('lingframe.appearance.v1')");
  const activePage=await evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  const logDir=path.join(root,"scripts","log");
  fs.mkdirSync(logDir,{recursive:true});
  for(const item of [
    {page:"doubao",file:"appearance-doubao-fixed.png",ready:".doubao-account-list .account[data-account-id]"},
    {page:"canvas",file:"appearance-canvas-isolated.png",ready:".lfc-stage"},
    {page:"settings",file:"appearance-model-gateway-contrast.png",ready:"#model-gateway-card .model-provider-item",scroll:"#model-gateway-card"}
  ]){
    await evaluate("document.querySelector('[data-page=\"" + item.page + "\"]')?.click();window.lingframeAppearance.set({theme:'comfort',fontSize:'xlarge',contrast:'clear'});true");
    for(let i=0;i<40;i++){if(await evaluate("Boolean(document.querySelector('" + item.ready + "'))"))break;await wait(50)}
    if(item.scroll) await evaluate("document.querySelector('" + item.scroll + "')?.scrollIntoView({block:'start'});true");
    await wait(180);
    const shot=await send("Page.captureScreenshot",{format:"png",captureBeyondViewport:false});
    fs.writeFileSync(path.join(logDir,item.file),Buffer.from(shot.data,"base64"));
  }
  await evaluate("(()=>{const saved=" + JSON.stringify(saved) + ";if(saved===null)localStorage.removeItem('lingframe.appearance.v1');else localStorage.setItem('lingframe.appearance.v1',saved);document.querySelector('[data-page=" + JSON.stringify(activePage) + "]')?.click();location.reload();return true})()");
  socket.close();
  console.log(JSON.stringify({ok:true,files:["appearance-doubao-fixed.png","appearance-canvas-isolated.png","appearance-model-gateway-contrast.png"]},null,2));
})().catch(error=>{console.error(error.stack||error);process.exitCode=1});
