"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const outputImage = path.join(root, "scripts", "log", "home-ui-live.png");
const outputReport = path.join(root, "scripts", "log", "home-ui-live.json");

async function main() {
  const targets = await fetch("http://127.0.0.1:9223/json").then(response => response.json());
  const target = targets.find(item => item.type === "page" && item.title === "灵帧AI");
  if (!target?.webSocketDebuggerUrl) throw new Error("未找到灵帧AI调试页面");

  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let sequence = 0;
  const pending = new Map();
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    pending.set(id, { resolve, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await call("Page.enable");
  const expression = `(() => {
    const q = selector => document.querySelector(selector);
    const rect = selector => {
      const value = q(selector)?.getBoundingClientRect();
      return value ? { x: value.x, y: value.y, width: value.width, height: value.height } : null;
    };
    return {
      title: q('.page-head h1')?.textContent || '',
      assistantCopyPresent: document.body.innerText.includes('AI创作助手'),
      homeShell: rect('.home-chat-shell'),
      sidebar: rect('.home-chat-sidebar'),
      main: rect('.home-chat-main'),
      taskDock: rect('#generation-live-shell'),
      taskText: q('#generation-live-shell')?.innerText?.slice(0, 500) || '',
      font: {
        page: getComputedStyle(q('.page-head h1')).fontSize,
        prompt: getComputedStyle(q('[data-home-prompt]')).fontSize,
        card: getComputedStyle(q('.card b')).fontSize,
        task: getComputedStyle(q('#generation-live-status')).fontSize,
      },
      overflow: {
        workspace: q('.workspace').scrollWidth - q('.workspace').clientWidth,
        main: q('.home-chat-main').scrollWidth - q('.home-chat-main').clientWidth,
      },
    };
  })()`;
  const metrics = await call("Runtime.evaluate", { expression, returnByValue: true });
  const screenshot = await call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  fs.mkdirSync(path.dirname(outputImage), { recursive: true });
  fs.writeFileSync(outputImage, Buffer.from(screenshot.data, "base64"));
  fs.writeFileSync(outputReport, JSON.stringify(metrics.result.value, null, 2), "utf8");
  socket.close();
  console.log(JSON.stringify({ image: outputImage, report: metrics.result.value }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
