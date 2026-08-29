"use strict";

const fs = require("fs");
const path = require("path");
const {BrowserController} = require("../src/main/browser-controller.cjs");

const root = path.resolve(__dirname, "..");
const port = Number(process.argv[2] || 9590);
const account = {id: "desktop-1", name: "白同学", platform: "豆包"};
const controller = new BrowserController({profileRootProvider: () => path.join(root, ".smoke-profile"), downloadRootProvider: () => path.join(root, "scripts", "log"), testMode: false});
const session = {account, embedded: false, port, profile: "existing-electron-target", captures: [], captureSeq: 0, consumedCaptures: new Set(), submissionRequests: [], assetUploadRequests: [], pendingAssetUpload: null, pendingSubmission: null, currentJobId: "fast-model-no-submit", conversationId: "", cdp: null, phase: "idle", testMode: false};

(async () => {
  let result = null;
  let pageState = null;
  const steps = [];
  let errorText = "";
  try {
    await controller.ensureVideoMode(session);
    const mini = await controller.setVideoParameters(session, {doubaoModel: "Seedance 2.0 Mini", ratio: "16:9", duration: "10s"});
    steps.push({name: "closed-menu-roundtrip-mini", result: mini});
    result = await controller.setVideoParameters(session, {doubaoModel: "Seedance 2.0 Fast", ratio: "16:9", duration: "10s"});
    steps.push({name: "closed-menu-roundtrip-fast", result});
    pageState = await controller.evaluate(session, `(() => {const visible=e=>{if(!e)return false;const r=e.getBoundingClientRect(),s=getComputedStyle(e);return r.width>2&&r.height>2&&s.display!=='none'&&s.visibility!=='hidden'};const model=[...document.querySelectorAll('[data-input-engine-actionbar-control-key="video-model"],button,[role="button"]')].filter(visible).find(e=>/Seedance\\s*2\\.0\\s*Fast/i.test(String(e.innerText||e.textContent||'')));const editor=[...document.querySelectorAll('textarea,[contenteditable="true"],[role="textbox"],[data-slate-editor="true"]')].filter(visible).sort((a,b)=>b.getBoundingClientRect().bottom-a.getBoundingClientRect().bottom)[0];return{url:location.href,modelText:String(model?.innerText||model?.textContent||'').replace(/\\s+/g,' ').trim(),composerText:String(editor?.value||editor?.innerText||editor?.textContent||'').trim()}})()`);
    if (result.model !== "Seedance 2.0 Fast" || !/Seedance\s*2\.0\s*Fast/i.test(pageState.modelText)) throw new Error(`Fast 模型页面确认失败：${JSON.stringify({result, pageState})}`);
    if (session.submissionRequests.length) throw new Error(`无提交验证捕获到 ${session.submissionRequests.length} 条生成请求`);
  } catch (error) {
    errorText = String(error.stack || error);
    throw error;
  } finally {
    try { session.cdp?.close(); } catch {}
    const report = {test: "doubao-fast-model-no-submit", timestamp: new Date().toISOString(), port, steps, result, pageState, submitted: session.submissionRequests.length > 0, submissionRequestCount: session.submissionRequests.length, passed: Boolean(result && pageState && !errorText && session.submissionRequests.length === 0), error: errorText};
    fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
    fs.writeFileSync(path.join(root, "scripts", "log", "doubao-fast-model-no-submit.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  }
  console.log(JSON.stringify({steps, result, pageState, submitted: false}, null, 2));
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
