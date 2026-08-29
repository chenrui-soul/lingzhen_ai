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
    const {resolve, reject} = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message || "CDP 调用失败"));
    else resolve(message.result);
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
      const api = window.lingframe;
      const before = await api.license.status();
      let refreshError = null;
      try { await api.license.refresh(); } catch (error) { refreshError = {code: error?.code || null, message: String(error?.message || error)}; }
      await new Promise(resolve => setTimeout(resolve, 350));
      const after = await api.license.status();
      const identity = await api.identity.status();
      const agent = await api.agent.status();
      const attempts = {};
      for (const [name, operation] of Object.entries({
        writeLocal: () => api.projects.setCurrent('__license-e2e-nonexistent__'),
        generate: () => api.generation.run('__license-e2e-nonexistent__'),
        accountControl: () => api.agent.openAccount({id:'__license-e2e__', name:'授权测试', platform:'豆包'})
      })) {
        try { await operation(); attempts[name] = {blocked:false}; }
        catch (error) { attempts[name] = {blocked:true, code:error?.code || null, message:String(error?.message || error)}; }
      }
      const history = await api.workbench.bootstrap();
      const noticeTitle = document.querySelector('#license-notice-title')?.textContent?.trim() || null;
      const gateBeforeChoice = document.querySelector('#license-gate h1')?.textContent?.trim() || null;
      document.querySelector('[data-license-notice-action="activate"]')?.click();
      await new Promise(resolve => setTimeout(resolve, 100));
      return {
        before: {state:before.state, usable:before.usable},
        refreshError,
        after: {state:after.state, usable:after.usable, hasTenant:Boolean(after.tenantId)},
        identity: {usable:identity.usable, hasTenant:Boolean(identity.tenantId)},
        agent: {online:agent.online === true},
        attempts,
        historyReadable: history?.locked !== true,
        noticeTitle,
        gateBeforeChoice,
        gateTitle: document.querySelector('#license-gate h1')?.textContent?.trim() || null,
        gateMessage: document.querySelector('#license-gate p')?.textContent?.trim() || null,
        statusBar: document.querySelector('.desktop-settings span')?.textContent?.trim() || null
      };
    })()`;
    const response = await send("Runtime.evaluate", {expression, awaitPromise: true, returnByValue: true});
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text || "客户端脚本执行失败");
    const result = response.result?.value;
    assert.equal(result.after.state, "revoked");
    assert.equal(result.after.usable, false);
    assert.equal(result.after.hasTenant, true);
    assert.equal(result.identity.usable, false);
    assert.equal(result.identity.hasTenant, true);
    assert.equal(result.noticeTitle, "设备密钥已失效");
    assert.equal(result.gateBeforeChoice, null);
    assert.equal(result.gateTitle, "授权已失效");
    assert.match(result.statusBar || "", /授权未激活/);
    assert.equal(result.historyReadable, true);
    for (const attempt of Object.values(result.attempts)) assert.equal(attempt.blocked, true);
    console.log(JSON.stringify({test: "live-license-revocation", passed: 14, failed: 0, result}, null, 2));
  } finally {
    socket.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({test: "live-license-revocation", passed: 0, failed: 1, error: String(error?.stack || error)}, null, 2));
  process.exit(1);
});
