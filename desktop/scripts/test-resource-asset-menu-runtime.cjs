const fs=require("fs");
const path=require("path");
const endpoint=process.argv[2]||"http://127.0.0.1:9223";
const root=path.resolve(__dirname,"..");
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function connect(){
  const targets=await fetch(`${endpoint}/json`).then(response=>response.json());
  const target=targets.find(item=>item.type==="page"&&String(item.url||"").includes("src/renderer/index.html"));
  if(!target?.webSocketDebuggerUrl)throw new Error("未找到正在运行的灵帧AI客户端页面");
  const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true})});
  let nextId=0;const pending=new Map();
  socket.addEventListener("message",event=>{const message=JSON.parse(String(event.data));if(!message.id||!pending.has(message.id))return;const handler=pending.get(message.id);pending.delete(message.id);message.error?handler.reject(new Error(message.error.message)):handler.resolve(message.result||{})});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++nextId;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const result=await send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||"页面执行失败");return result.result?.value};
  return {send,evaluate,close:()=>socket.close()};
}

async function main(){
  let client=await connect();await client.send("Page.reload",{ignoreCache:true});client.close();await wait(900);client=await connect();
  const result=await client.evaluate(`(async()=>{
    const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    if(!document.querySelector('.resource-library')){document.querySelector('[data-page="resources"],[data-page="materials"]')?.click();await wait(700)}
    const workspace=document.querySelector('.workspace'),summaries=[...document.querySelectorAll('.asset-action-menu>summary')];
    if(!workspace||summaries.length<2)return {ok:false,reason:'当前页面可测试素材卡片少于 2 张',menuCount:summaries.length};
    summaries[0].click();await wait(60);const afterFirst=document.querySelectorAll('.asset-action-menu[open]').length;
    summaries[1].click();await wait(60);const menus=[...document.querySelectorAll('.asset-action-menu')],afterSecond=document.querySelectorAll('.asset-action-menu[open]').length,firstClosed=!menus[0].open,secondOpen=menus[1].open;
    document.querySelector('.resource-page-head')?.click();await wait(60);const outsideClosed=document.querySelectorAll('.asset-action-menu[open]').length===0;
    summaries[0].click();await wait(60);workspace.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));await wait(60);const escapeClosed=!menus[0].open,focusRestored=document.activeElement===summaries[0];
    summaries[0].click();await wait(60);menus[0].querySelector('.asset-actions').dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));await wait(60);const actionClosed=!menus[0].open;
    return {ok:afterFirst===1&&afterSecond===1&&firstClosed&&secondOpen&&outsideClosed&&escapeClosed&&focusRestored&&actionClosed,afterFirst,afterSecond,firstClosed,secondOpen,outsideClosed,escapeClosed,focusRestored,actionClosed,ariaExpanded:summaries[0].getAttribute('aria-expanded')};
  })()`);client.close();
  const report={test:"resource-asset-action-menu-runtime",timestamp:new Date().toISOString(),endpoint,...result};const logDir=path.join(root,"scripts/log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"resource-asset-menu-runtime.json"),JSON.stringify(report,null,2)+"\n");console.log(JSON.stringify(report,null,2));if(!result.ok)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1});
