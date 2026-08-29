"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-conversations-phase1-ground-truth.json"), "utf8"));
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop");
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
  if (!target) throw new Error(`未找到目标页面：${targetHint} @ ${port}`);
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
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  return { send, evaluate, close: () => socket.close() };
}

(async () => {
  const cdp = await connect();
  const activePage = await cdp.evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  const saved = {};
  const checks = [];
  const check = (name, ok, detail = null) => checks.push({ name, ok: Boolean(ok), detail });
  let storageKey = '';
  try {
    await cdp.evaluate("location.reload(); true");
    await wait(650);
    await cdp.evaluate("document.querySelector('[data-page=\"home\"]')?.click(); true");
    for (let i = 0; i < 100; i++) {
      if (await cdp.evaluate("Boolean(document.querySelector('.home-chat-shell [data-home-prompt]'))")) break;
      await wait(50);
    }
    const selectorState = await cdp.evaluate(`(${JSON.stringify(truth.requiredSelectors)}).map(selector=>({selector,found:Boolean(document.querySelector(selector))}))`);
    check("required conversation UI exists", selectorState.every(item => item.found), selectorState);
    storageKey = await cdp.evaluate("document.querySelector('.home-chat-shell')?.dataset.homeChatStorageKey || ''");
    check("storage is tenant/project scoped", storageKey.startsWith(truth.storagePrefix + '.') && storageKey.split('.').length >= 5, storageKey);
    if (!storageKey) throw new Error(`首页对话工作台未初始化：${JSON.stringify(selectorState)}`);
    saved[storageKey] = await cdp.evaluate(`localStorage.getItem(${JSON.stringify(storageKey)})`);
    const initialCount = await cdp.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).conversations.length`);
    await cdp.evaluate("document.querySelector('[data-home-chat-new]').click(); true");
    await wait(80);
    const afterNew = await cdp.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}))`);
    check("new conversation is persisted", afterNew.conversations.length === initialCount + 1 && afterNew.activeId === afterNew.conversations[0].id, { initialCount, after: afterNew.conversations.length });

    const draft = `第一批草稿-${Date.now()}`;
    await cdp.evaluate(`(()=>{const input=document.querySelector('[data-home-prompt]');input.value=${JSON.stringify(draft)};input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await wait(420);
    const storedDraft = await cdp.evaluate(`(()=>{const data=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));return data.conversations.find(item=>item.id===data.activeId)?.draft})()`);
    check("draft is automatically persisted", storedDraft === draft, { expected: draft, actual: storedDraft });

    await cdp.evaluate("location.reload(); true");
    await wait(700);
    const restoredDraft = await cdp.evaluate("document.querySelector('[data-home-prompt]')?.value || ''");
    check("draft is restored after reload", restoredDraft === draft, { expected: draft, actual: restoredDraft });

    await cdp.evaluate("document.querySelector('.home-chat-item.active [data-home-chat-more]').click();document.querySelector('.home-chat-item.active [data-home-chat-rename]').click();true");
    await wait(40);
    const renamed = `测试对话-${Date.now()}`;
    await cdp.evaluate(`(()=>{const input=document.querySelector('[data-home-chat-modal-input]');input.value=${JSON.stringify(renamed)};document.querySelector('[data-home-chat-modal-confirm]').click();return true})()`);
    await wait(60);
    const storedTitle = await cdp.evaluate(`(()=>{const data=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));return data.conversations.find(item=>item.id===data.activeId)?.title})()`);
    check("conversation can be renamed", storedTitle === renamed, { expected: renamed, actual: storedTitle });

    await cdp.evaluate(`(()=>{const input=document.querySelector('[data-home-prompt]');input.value=${JSON.stringify(draft)};input.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('[data-home-submit]').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));return true})()`);
    await wait(80);
    const recordState = await cdp.evaluate(`(()=>{const data=JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)}));const item=data.conversations.find(x=>x.id===data.activeId);return {messages:item.messages.length,user:item.messages.find(message=>message.role==='user')?.content||'',bubbles:document.querySelectorAll('.home-chat-message').length}})()`);
    check("input record is stored without submitting a backend click", recordState.messages >= 2 && recordState.user === draft && recordState.bubbles >= 2, recordState);

    const beforeDelete = await cdp.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).conversations.length`);
    await cdp.evaluate("document.querySelector('.home-chat-item.active [data-home-chat-more]').click();document.querySelector('.home-chat-item.active [data-home-chat-delete]').click();true");
    await wait(40);
    await cdp.evaluate("document.querySelector('[data-home-chat-modal-confirm]').click(); true");
    await wait(60);
    const afterDelete = await cdp.evaluate(`JSON.parse(localStorage.getItem(${JSON.stringify(storageKey)})).conversations.length`);
    check("conversation can be deleted", afterDelete === Math.max(1, beforeDelete - 1), { beforeDelete, afterDelete });

    const layout = await cdp.evaluate(`(()=>{const workspace=document.querySelector('.workspace'),shell=document.querySelector('.home-chat-shell'),main=document.querySelector('.home-chat-main');return{workspace:{clientHeight:workspace.clientHeight,scrollHeight:workspace.scrollHeight},shellHeight:shell.getBoundingClientRect().height,mainHeight:main.getBoundingClientRect().height}})()`);
    check("home conversation workspace has no page overflow", layout.workspace.scrollHeight <= layout.workspace.clientHeight + truth.maximumWorkspaceOverflowPx && Math.abs(layout.shellHeight-layout.mainHeight)<=1, layout);
    const screenshot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "home-conversations-phase1.png"), Buffer.from(screenshot.data, "base64"));
  } finally {
    if (storageKey) await cdp.evaluate(`(()=>{const value=${JSON.stringify(saved[storageKey])};if(value===null)localStorage.removeItem(${JSON.stringify(storageKey)});else localStorage.setItem(${JSON.stringify(storageKey)},value);return true})()`).catch(() => {});
    await cdp.evaluate(`document.querySelector('[data-page=${JSON.stringify(activePage)}]')?.click();location.reload();true`).catch(() => {});
    cdp.close();
  }
  const failed = checks.filter(item => !item.ok);
  const report = { test: "home-conversations-phase1-runtime", timestamp: new Date().toISOString(), port, targetHint, groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
  const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir, { recursive: true });
  fs.writeFileSync(path.join(logDir, "home-conversations-phase1-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
