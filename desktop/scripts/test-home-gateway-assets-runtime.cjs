"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const checks = [];
const check = (name, ok, detail = null) => checks.push({name, ok: Boolean(ok), detail});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch("http://127.0.0.1:9333/json/list")).json();
  const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
  if (!target) throw new Error("灵帧AI客户端页面未启动");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(`${method} timeout`)), 10000);
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer);
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({id, method, params}));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluate failed");
    return result.result?.value;
  };
  return {send, evaluate, close: () => socket.close()};
}

async function waitFor(evaluate, expression, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await wait(50);
  }
  return false;
}

(async () => {
  const cdp = await connect();
  const url = `file:///${path.join(root, "src/renderer/index.html").replace(/\\/g, "/")}`;
  await cdp.send("Page.navigate", {url});
  await waitFor(cdp.evaluate, "Boolean(document.querySelector('.shell'))");
  await cdp.evaluate("document.querySelector('[data-page=\"home\"]')?.click();true");
  await waitFor(cdp.evaluate, "document.querySelectorAll('[data-home-asset-add]').length===4&&Boolean(document.querySelector('[data-home-gateway-resolution]'))");

  const before = await cdp.evaluate(`(()=>({
    assetTypes:[...document.querySelectorAll('[data-home-asset-add]')].map(button=>button.dataset.homeAssetAdd),
    shelf:Boolean(document.querySelector('[data-home-assets]')),
    shelfDisplay:getComputedStyle(document.querySelector('[data-home-assets]')).display,
    doubaoDuration:Boolean(document.querySelector('[data-home-duration]')),
    gatewayDuration:Boolean(document.querySelector('[data-home-gateway-duration]')),
    gatewayResolution:Boolean(document.querySelector('[data-home-gateway-resolution]'))
  }))()`);
  check(
    "首页四类素材入口与附件架已真实渲染",
    JSON.stringify([...before.assetTypes].sort()) === JSON.stringify(["audio", "image", "text", "video"]) && before.shelf && before.shelfDisplay === "none",
    before
  );
  check("豆包与模型网关使用独立参数控件", before.doubaoDuration && before.gatewayDuration && before.gatewayResolution, before);

  const runtime = await cdp.evaluate(`(async()=>{
    const providers=await window.lingframe.models.bootstrap();
    const select=document.querySelector('[data-home-model-select]');
    const video=providers.flatMap(provider=>(provider.models||[]).map(model=>({provider,model,value:provider.id+'::'+model.id}))).find(item=>item.model.enabled!==false&&item.model.capabilities?.type==='video'&&[...select.options].some(option=>option.value===item.value));
    const channel=document.querySelector('[data-home-channel]');
    channel.value='model-gateway';
    channel.dispatchEvent(new Event('change',{bubbles:true}));
    if(video){select.value=video.value;select.dispatchEvent(new Event('change',{bubbles:true}));}
    await new Promise(resolve=>setTimeout(resolve,100));
    return{
      videoFound:Boolean(video),
      modelId:video?.model.id||select.value,
      expectedDurations:video?.model.capabilities?.durations||[],
      expectedResolutions:video?.model.capabilities?.resolutions||[],
      durationDisplay:getComputedStyle(document.querySelector('[data-home-gateway-duration-wrap]')).display,
      resolutionDisplay:getComputedStyle(document.querySelector('[data-home-gateway-resolution-wrap]')).display,
      durations:[...document.querySelector('[data-home-gateway-duration]').options].map(option=>option.value),
      resolutions:[...document.querySelector('[data-home-gateway-resolution]').options].map(option=>option.value),
      doubaoDurationDisplay:getComputedStyle(document.querySelector('[data-home-duration-wrap]')).display,
      modelDisplay:getComputedStyle(document.querySelector('[data-home-model]')).display
    };
  })()`);
  check("切换模型网关后豆包时长隐藏且模型选择显示", runtime.doubaoDurationDisplay === "none" && runtime.modelDisplay !== "none", runtime);
  check("网关时长按所选模型能力动态显示", !runtime.videoFound || (runtime.durationDisplay !== "none" && JSON.stringify(runtime.durations) === JSON.stringify(runtime.expectedDurations)), runtime);
  check("网关清晰度按所选模型能力动态显示", !runtime.videoFound || (runtime.resolutionDisplay !== "none" && JSON.stringify(runtime.resolutions) === JSON.stringify(runtime.expectedResolutions)), runtime);

  const shot = await cdp.send("Page.captureScreenshot", {format: "png", captureBeyondViewport: false});
  const screenshot = path.join(root, "scripts/log/home-gateway-assets-runtime.png");
  fs.mkdirSync(path.dirname(screenshot), {recursive: true});
  fs.writeFileSync(screenshot, Buffer.from(shot.data, "base64"));
  const failed = checks.filter(item => !item.ok);
  const report = {test: "home-gateway-assets-runtime", timestamp: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks, screenshot};
  fs.writeFileSync(path.join(root, "scripts/log/home-gateway-assets-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  cdp.close();
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
