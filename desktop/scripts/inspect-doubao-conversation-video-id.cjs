"use strict";

const http = require("http");

function json(url){return new Promise((resolve,reject)=>http.get(url,response=>{const chunks=[];response.on("data",chunk=>chunks.push(chunk));response.on("end",()=>{try{resolve(JSON.parse(Buffer.concat(chunks)))}catch(error){reject(error)}})}).on("error",reject))}

async function main(){
  const port=Number(process.env.LINGFRAME_CDP_PORT||9333),conversationId=String(process.argv[2]||"");
  const targets=(await json(`http://127.0.0.1:${port}/json/list`)).filter(item=>item.type==="page"&&/doubao\.com/.test(item.url));
  const target=targets.find(item=>!conversationId||item.url.includes(conversationId))||targets[0];if(!target)throw new Error("未找到豆包调试页面");
  const socket=new WebSocket(target.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{socket.onopen=resolve;socket.onerror=reject});
  let sequence=0;const pending=new Map(),requests=new Map(),responses=new Map(),bodies=[];
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++sequence;pending.set(id,{resolve,reject});socket.send(JSON.stringify({id,method,params}))});
  socket.onmessage=event=>{const message=JSON.parse(String(event.data));if(message.id&&pending.has(message.id)){const entry=pending.get(message.id);pending.delete(message.id);return message.error?entry.reject(new Error(message.error.message)):entry.resolve(message.result||{})}if(message.method==="Network.requestWillBeSent"){const request=message.params?.request||{};requests.set(message.params?.requestId||"",{url:request.url||"",method:request.method||"",postData:request.postData||""})}if(message.method==="Network.responseReceived"){const response=message.params?.response||{},requestId=message.params?.requestId||"";if(/\/im\/conversation\/info|\/im\/message\//i.test(response.url||""))responses.set(requestId,{requestId,url:response.url||"",mimeType:response.mimeType||"",request:requests.get(requestId)||{}})}if(message.method==="Network.loadingFinished"){const requestId=message.params?.requestId||"",response=responses.get(requestId);if(response)send("Network.getResponseBody",{requestId}).then(result=>bodies.push({...response,body:result.base64Encoded?Buffer.from(result.body||"","base64").toString("utf8"):String(result.body||"")})).catch(()=>{})}};
  await send("Page.enable");await send("Network.enable");await send("Page.reload",{ignoreCache:true});await new Promise(resolve=>setTimeout(resolve,8000));socket.close();
  process.stdout.write(JSON.stringify({target:target.url,bodies},null,2));
}

main().catch(error=>{console.error(error.stack||error);process.exit(1)});
