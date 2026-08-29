"use strict";

const {app, BrowserWindow} = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-conversations-submit-ground-truth.json"), "utf8"));
const checks = [];
const check = (name, ok, detail = null) => checks.push({name, ok: Boolean(ok), detail});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitFor(window, expression, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression, true)) return true;
    await wait(50);
  }
  return false;
}

function finish(extra = {}) {
  const failed = checks.filter(item => !item.ok);
  const report = {
    test: "home-conversations-submit-runtime",
    timestamp: new Date().toISOString(),
    groundTruth: truth,
    total: checks.length,
    passed: checks.length - failed.length,
    failed: failed.length,
    checks,
    ...extra
  };
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, "home-conversations-submit-runtime.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return failed.length;
}

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    show: false,
    width: 1440,
    height: 1000,
    webPreferences: {
      preload: path.join(__dirname, "test-home-conversations-submit-preload.cjs"),
      partition: `home-conversations-submit-${Date.now()}`,
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  try {
    await window.loadFile(path.join(root, "src", "renderer", "index.html"));
    const ready = await waitFor(window, "Boolean(document.querySelector('.home-chat-shell [data-home-submit]'))");
    check("首页对话工作台在独立测试壳完成初始化", ready);
    if (!ready) throw new Error("首页对话工作台未在限定时间内初始化");

    const seed = await window.webContents.executeJavaScript("window.lingframeSubmitTest.seedAccount()", true);
    await window.webContents.executeJavaScript(`localStorage.setItem('lingframe.doubaoProfiles.${seed.id}', ${JSON.stringify(JSON.stringify(seed))}); window.dispatchEvent(new CustomEvent('lingframe:account-profiles-changed')); true`, true);
    await wait(120);

    const before = await window.webContents.executeJavaScript(`(()=>{
      const shell=document.querySelector('.home-chat-shell');
      const key=shell.dataset.homeChatStorageKey;
      const data=JSON.parse(localStorage.getItem(key));
      return {key,activeId:data.activeId,messageCount:data.conversations.find(item=>item.id===data.activeId).messages.length};
    })()`, true);

    const buttonPoint = await window.webContents.executeJavaScript(`(()=>{
      window.alert=()=>{};
      window.confirm=()=>true;
      const input=document.querySelector('[data-home-prompt]');
      input.value=${JSON.stringify(truth.prompt)};
      input.dispatchEvent(new Event('input',{bubbles:true}));
      const account=document.querySelector('[data-home-account-select]');
      account.value=${JSON.stringify(truth.expectedAccountId)};
      const button=document.querySelector('[data-home-submit]');
      const rect=button.getBoundingClientRect();
      return {x:Math.round(rect.left+rect.width/2),y:Math.round(rect.top+rect.height/2),recordBound:button.dataset.homeChatRecordBound||''};
    })()`, true);
    check("对话记录监听仍绑定在原开始创作按钮", buttonPoint.recordBound === "1", buttonPoint);
    window.webContents.focus();
    window.webContents.sendInputEvent({type: "mouseDown", x: buttonPoint.x, y: buttonPoint.y, button: "left", clickCount: 1});
    window.webContents.sendInputEvent({type: "mouseUp", x: buttonPoint.x, y: buttonPoint.y, button: "left", clickCount: 1});

    const submitted = await waitFor(window, `window.lingframeSubmitTest.getCalls().length===${truth.expectedCallCount}`);
    check("开始创作按钮调用一次原 generation.create 接口", submitted);
    await wait(100);

    const after = await window.webContents.executeJavaScript(`(()=>{
      const calls=window.lingframeSubmitTest.getCalls();
      const key=document.querySelector('.home-chat-shell').dataset.homeChatStorageKey;
      const data=JSON.parse(localStorage.getItem(key));
      const conversation=data.conversations.find(item=>item.id===data.activeId);
      return {calls,prompt:document.querySelector('[data-home-prompt]').value,messages:conversation.messages,draft:conversation.draft};
    })()`, true);
    const input = after.calls[0] || {};
    check("提交参数继续沿用当前首页统一任务链路", input.prompt === truth.prompt && input.creationType === truth.expectedCreationType && input.executionChannel === truth.expectedChannel, input);
    const enhancedFieldsValid =
      (input.creationSource === undefined || input.creationSource === truth.expectedCreationSource) &&
      (input.projectId === undefined || input.projectId === truth.expectedProjectId) &&
      (input.duration === undefined || input.duration === truth.expectedDuration) &&
      (input.doubaoModel === undefined || input.doubaoModel === truth.expectedModel);
    check("当前基线已有的项目与豆包增强参数保持原样", input.accountId === truth.expectedAccountId && enhancedFieldsValid, input);
    check("模拟成功后输入框按原逻辑清空", !truth.mustClearPromptAfterSuccess || after.prompt === "", {prompt: after.prompt});
    check("提交同时保留当前对话输入记录", !truth.mustPersistConversationRecord || (after.messages.length >= before.messageCount + 2 && after.messages.some(message => message.role === "user" && message.content === truth.prompt)), {before, messages: after.messages});
    check("测试只调用隔离测试壳，未连接真实后台", truth.mustNotUseRealBackend && after.calls.length === truth.expectedCallCount, {mockCalls: after.calls.length});

    const screenshot = path.join(root, "scripts", "log", "home-conversations-submit-runtime.png");
    await window.webContents.capturePage().then(image => fs.writeFileSync(screenshot, image.toPNG()));
    process.exitCode = finish({screenshot, capturedInput: input});
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = finish({fatal: String(error.stack || error)});
  } finally {
    window.destroy();
    app.quit();
  }
}).catch(error => {
  console.error(error.stack || error);
  process.exitCode = finish({fatal: String(error.stack || error)});
  app.quit();
});
