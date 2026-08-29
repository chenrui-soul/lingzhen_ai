"use strict";

const http = require("http");

function json(url) {
  return new Promise((resolve, reject) => http.get(url, response => {
    const chunks = [];
    response.on("data", chunk => chunks.push(chunk));
    response.on("end", () => { try { resolve(JSON.parse(Buffer.concat(chunks))); } catch (error) { reject(error); } });
  }).on("error", reject));
}

async function main() {
  const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
  const index = Number(process.argv[2] || 0);
  const targets = (await json(`http://127.0.0.1:${port}/json/list`)).filter(item => item.type === "page" && /doubao\.com/.test(item.url));
  const target = targets[index];
  if (!target) throw new Error("未找到豆包调试页面");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const pending = new Map();
  const responses = [];
  const requests = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(String(event.data));
    if (message.id && pending.has(message.id)) {
      const entry = pending.get(message.id);pending.delete(message.id);
      return message.error ? entry.reject(new Error(message.error.message)) : entry.resolve(message.result || {});
    }
    if (message.method === "Network.responseReceived") {
      const response = message.params?.response || {};
      const requestId=message.params?.requestId || "",request=requests.get(requestId)||{};
      responses.push({requestId,url:response.url || "",mimeType:response.mimeType || "",status:response.status || 0,headers:response.headers || {},method:request.method||"",postData:request.postData||""});
    }
    if(message.method === "Network.requestWillBeSent"){const request=message.params?.request||{};requests.set(message.params?.requestId||"",{method:request.method||"",postData:request.postData||"",url:request.url||""});}
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;pending.set(id, {resolve, reject});socket.send(JSON.stringify({id, method, params}));
  });
  await send("Network.enable");
  if (process.argv.includes("--reload")) {
    await send("Page.enable");
    await send("Page.reload", {ignoreCache:true});
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  const clicked = await send("Runtime.evaluate", {returnByValue:true,expression:`(() => {const box=[...document.querySelectorAll('[data-message-id]')].find(node=>/视频生成好了/.test(node.innerText||''))?.querySelector('[class*="block-video"],[class*="video-player"]');if(!box)return false;box.click();return true;})()`});
  await new Promise(resolve => setTimeout(resolve, 5000));
  const resources = await send("Runtime.evaluate", {returnByValue:true,expression:`performance.getEntriesByType('resource').slice(-120).map(item=>item.name)`});
  const selected = responses.filter(item => /video|play|media|chat|message|conversation|generation|get_without_watermark|creativity\/resource/i.test(`${item.url} ${item.mimeType}`));
  const bodies = [];
  for (const item of selected.filter(item => /json|text\/plain/i.test(item.mimeType)||/get_without_watermark|creativity\/resource/i.test(item.url)).slice(-20)) {
    try {
      const body = await send("Network.getResponseBody", {requestId:item.requestId});
      if (/\bvid\b|video_id|videoId/i.test(body.body || "")||/get_without_watermark|creativity\/resource/i.test(item.url)) bodies.push({url:item.url,method:item.method,postData:item.postData,body:String(body.body || "").slice(0,30000)});
    } catch {}
  }
  socket.close();
  process.stdout.write(JSON.stringify({target:target.url,clicked:clicked.result?.value===true,responses:selected,resources:resources.result?.value || [],bodies}, null, 2));
}

main().catch(error => { console.error(error.stack || error);process.exit(1); });
