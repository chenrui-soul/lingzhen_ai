"use strict";
const {WebSocket} = require("undici");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9556);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => item.type === "page" && String(item.url || "").includes("src/renderer/index.html"));
  if (!target) throw new Error(`端口 ${port} 未找到灵帧AI客户端页面`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const evaluate = expression => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error("Runtime.evaluate timeout")), 12000);
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      clearTimeout(timer); socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else if (message.result?.exceptionDetails) reject(new Error(message.result.exceptionDetails.text || "evaluate failed"));
      else resolve(message.result?.result?.value);
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({id, method:"Runtime.evaluate", params:{expression, awaitPromise:true, returnByValue:true}}));
  });
  return {evaluate, close:() => socket.close()};
}

(async () => {
  const cdp = await connect();
  const checks = [];
  const check = (name, ok, detail) => checks.push({name, ok:Boolean(ok), detail});
  try {
    const originalPage = await cdp.evaluate("document.querySelector('.nav.active[data-page]')?.dataset.page||'home'");
    await cdp.evaluate("(()=>{window.__batchFMainlineErrors=[];window.addEventListener('error',event=>window.__batchFMainlineErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener('unhandledrejection',event=>window.__batchFMainlineErrors.push(String(event.reason?.stack||event.reason)));document.querySelector('[data-page=text]')?.click();return true})()");
    for (let index = 0; index < 60; index += 1) {
      if (await cdp.evaluate("Boolean(document.querySelector('[data-text-content]')&&document.querySelector('[data-text-assist-tab=quality]'))")) break;
      await wait(100);
    }
    const loaded = await cdp.evaluate("(()=>({owner:window.lingframeTextQualityBatchF?.ownsQualityAndExport===true,core:Boolean(window.lingframeTextQualityCore),categories:window.lingframeTextQualityBatchF?.categories?.length||0,formats:window.lingframeTextQualityBatchF?.formats?.length||0,entry:document.querySelector('[data-text-export]')?.textContent||''}))()");
    check("9556 主线已加载批次 F 模块", loaded.owner && loaded.core && loaded.categories === 4 && loaded.formats === 5, loaded);
    check("9556 文本中央入口已升级为检查导出", loaded.entry === "检查/导出", loaded.entry);
    await cdp.evaluate("document.querySelector('[data-text-assist-tab=quality]')?.click();true"); await wait(100);
    const panel = await cdp.evaluate("(()=>({active:document.querySelector('[data-text-assist-tab=quality]')?.classList.contains('on'),visible:!document.querySelector('[data-text-assist-body=quality]')?.classList.contains('is-hidden'),categories:document.querySelectorAll('[data-text-quality-category]').length,exports:document.querySelectorAll('[data-text-quality-export]').length}))()");
    check("9556 检查导出面板可真实打开", panel.active && panel.visible && panel.categories === 4 && panel.exports === 5, panel);
    const errors = await cdp.evaluate("window.__batchFMainlineErrors||[]");
    check("9556 批次 F 加载无运行时异常", errors.length === 0, errors);
    await cdp.evaluate(`document.querySelector('[data-page=${JSON.stringify(originalPage)}]')?.click();true`);
  } finally { cdp.close(); }
  const failed = checks.filter(item => !item.ok);
  const report = {test:"text-quality-mainline-cdp", timestamp:new Date().toISOString(), port, total:checks.length, passed:checks.length - failed.length, failed:failed.length, checks};
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
