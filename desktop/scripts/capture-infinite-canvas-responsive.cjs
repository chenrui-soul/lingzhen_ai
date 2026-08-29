"use strict";

const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const port = Number(process.env.LINGFRAME_CDP_PORT || 9334);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop_v1");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
  if (!target) throw new Error(`未找到截图目标页面：${targetHint} @ ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;
  const savedAppearance = await evaluate("localStorage.getItem('lingframe.appearance.v1')");
  const activePage = await evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  try {
    await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1100, deviceScaleFactor: 1, mobile: false });
    await evaluate("document.querySelector('[data-page=\"canvas\"]')?.click();window.lingframeAppearance.set({theme:'comfort',fontSize:'xlarge',contrast:'clear'});true");
    for (let i = 0; i < 80; i++) {
      if (await evaluate("Boolean(document.querySelector('.lfc-stage') && document.querySelector('.lfc-inspector'))")) break;
      await wait(50);
    }
    await evaluate("document.querySelector('.lfc-stage')?.classList.remove('left-collapsed'); true");
    await wait(180);
    const shot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const output = path.join(root, "scripts", "log", "infinite-canvas-responsive-xlarge.png");
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, Buffer.from(shot.data, "base64"));
    console.log(output);
  } finally {
    await send("Emulation.clearDeviceMetricsOverride").catch(() => {});
    await evaluate(`(()=>{const saved=${JSON.stringify(savedAppearance)};if(saved===null)localStorage.removeItem('lingframe.appearance.v1');else localStorage.setItem('lingframe.appearance.v1',saved);document.querySelector('[data-page=${JSON.stringify(activePage)}]')?.click();location.reload();return true})()`).catch(() => {});
    socket.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
