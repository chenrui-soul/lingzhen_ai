"use strict";

const assert = require("assert");

const endpoint = process.argv[2] || "http://127.0.0.1:9223";

async function connect() {
  const targets = await fetch(`${endpoint}/json`).then(response => response.json());
  const target = targets.find(item => item.type === "page" && item.url.includes("/src/renderer/index.html"));
  if (!target?.webSocketDebuggerUrl) throw new Error("未找到灵帧AI客户端调试页面");
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, {once: true});
    socket.addEventListener("error", reject, {once: true});
  });
  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(String(event.data));
    if (!message.id || !pending.has(message.id)) return;
    const pendingCall = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) pendingCall.reject(new Error(message.error.message || "CDP 调用失败"));
    else pendingCall.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, {resolve, reject});
    socket.send(JSON.stringify({id, method, params}));
  });
  return {socket, send};
}

async function main() {
  const {socket, send} = await connect();
  try {
    const expression = `(async () => {
      const deadline = Date.now() + 8000;
      let status = await window.lingframe.license.status();
      const initial = {state:status.state, usable:status.usable};
      while (status.state !== 'revoked' && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 250));
        status = await window.lingframe.license.status();
      }
      await new Promise(resolve => setTimeout(resolve, 250));
      const identity = await window.lingframe.identity.status();
      const noticeTitle = document.querySelector('#license-notice-title')?.textContent?.trim() || null;
      document.querySelector('[data-license-notice-action="later"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        initial,
        final:{state:status.state, usable:status.usable, hasTenant:Boolean(status.tenantId)},
        identity:{usable:identity.usable, hasTenant:Boolean(identity.tenantId)},
        noticeTitle,
        noticeAfterChoice:document.querySelector('#license-notice-title')?.textContent?.trim() || null,
        gateTitle:document.querySelector('#license-gate h1')?.textContent?.trim() || null,
        hasReactivateButton:Boolean(document.querySelector('#desktop-activate')),
        statusBar:document.querySelector('.desktop-settings span')?.textContent?.trim() || null
      };
    })()`;
    const response = await send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "客户端脚本执行失败");
    const result = response.result?.value;
    assert.equal(result.final.state, "revoked");
    assert.equal(result.final.usable, false);
    assert.equal(result.final.hasTenant, true);
    assert.equal(result.identity.usable, false);
    assert.equal(result.identity.hasTenant, true);
    assert.equal(result.noticeTitle, "设备密钥已失效");
    assert.equal(result.noticeAfterChoice, null);
    assert.equal(result.gateTitle, null);
    assert.equal(result.hasReactivateButton, true);
    assert.match(result.statusBar || "", /授权未激活/);
    console.log(JSON.stringify({test:"live-license-auto-revocation",passed:10,failed:0,result}, null, 2));
  } finally {
    socket.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({test:"live-license-auto-revocation",passed:0,failed:1,error:String(error?.stack || error)}, null, 2));
  process.exit(1);
});
