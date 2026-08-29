"use strict";
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "appearance-module-isolation-ground-truth.json"), "utf8"));
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop");
const requireCanvas = process.env.APPEARANCE_REQUIRE_CANVAS === "1";
const checks = [];
const check = (name, ok, detail = null) => checks.push({name, ok: Boolean(ok), detail});
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  const targets = await (await fetch("http://127.0.0.1:" + port + "/json/list")).json();
  const target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
  if (!target) throw new Error("未找到目标页面：" + targetHint + " @ " + port);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => reject(new Error(method + " timeout")), 10000);
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
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  return {evaluate, close: () => socket.close()};
}

async function waitFor(evaluate, expression, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await wait(50);
  }
  return false;
}

function doubaoProbe() {
  const rect = value => {
    const r = value.getBoundingClientRect();
    return {left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height};
  };
  const noOverlap = (a, b) => a.right <= b.left + .5 || b.right <= a.left + .5 || a.bottom <= b.top + .5 || b.bottom <= a.top + .5;
  const cards = [...document.querySelectorAll(".doubao-account-list .account[data-account-id]")].filter(card => getComputedStyle(card).display !== "none");
  const cardData = cards.map(card => {
    const cardRect = rect(card);
    const actions = card.querySelector(".account-actions");
    const actionRect = actions ? rect(actions) : null;
    const buttons = [...card.querySelectorAll(".account-actions button")].map(rect);
    const buttonOverlaps = [];
    for (let i=0;i<buttons.length;i++) for (let j=i+1;j<buttons.length;j++) if (!noOverlap(buttons[i], buttons[j])) buttonOverlaps.push([i,j]);
    return {id:card.dataset.accountId, card:cardRect, actions:actionRect, buttons, buttonOverlaps, scrollWidth:card.scrollWidth, clientWidth:card.clientWidth, scrollHeight:card.scrollHeight, clientHeight:card.clientHeight};
  });
  const cardOverlaps = [];
  for (let i=0;i<cardData.length-1;i++) if (cardData[i].card.bottom + 4 > cardData[i+1].card.top + 1) cardOverlaps.push([cardData[i].id,cardData[i+1].id]);
  const contained = cardData.every(item => item.actions && item.actions.left >= item.card.left-1 && item.actions.right <= item.card.right+1 && item.actions.bottom <= item.card.bottom+1 && item.buttons.every(button => button.left >= item.card.left-1 && button.right <= item.card.right+1 && button.bottom <= item.card.bottom+1));
  const noButtonOverlap = cardData.every(item => item.buttonOverlaps.length === 0);
  const noInternalOverflow = cardData.every(item => item.scrollWidth <= item.clientWidth+1 && item.scrollHeight <= item.clientHeight+1);
  const list = document.querySelector(".doubao-account-list");
  const rail = document.querySelector(".doubao-account-rail");
  return {cardData, cardOverlaps, contained, noButtonOverlap, noInternalOverflow, listOverflow:list.scrollWidth-list.clientWidth, railOverflow:rail.scrollWidth-rail.clientWidth};
}

function canvasProbe() {
  const size = selector => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return {width:r.width, height:r.height, fontSize:parseFloat(style.fontSize), backgroundColor:style.backgroundColor, scrollWidth:el.scrollWidth, clientWidth:el.clientWidth, scrollHeight:el.scrollHeight, clientHeight:el.clientHeight};
  };
  return {stage:size(".lfc-stage"), viewport:size(".lfc-viewport"), librarySmall:size(".lfc-library-node small"), nodeTitle:size(".lfc-node-head strong"), runButton:size(".lfc-command-actions .primary"), commandbar:size(".lfc-commandbar"), inspector:size(".lfc-inspector"), inspectorSmall:size(".lfc-inspector-head small"), inspectorTab:size(".lfc-inspector-tabs button"), right:size(".shell.lfc-page-active .right"), workspace:size(".workspace")};
}

(async () => {
  const cdp = await connect();
  const saved = await cdp.evaluate("localStorage.getItem('lingframe.appearance.v1')");
  const activePage = await cdp.evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  await cdp.evaluate("document.querySelector('[data-page=\"doubao\"]')?.click();true");
  await waitFor(cdp.evaluate, "document.querySelectorAll('.doubao-account-list .account[data-account-id]').length >= 3");
  const doubaoAudit = {};
  for (const theme of truth.themes) {
    for (const fontSize of truth.fontSizes) {
      const key = theme + "/" + fontSize;
      await cdp.evaluate("window.lingframeAppearance.set(" + JSON.stringify({theme,fontSize}) + ")");
      await wait(90);
      doubaoAudit[key] = await cdp.evaluate("(" + doubaoProbe.toString() + ")()");
    }
  }
  check("豆包账号卡片在全部主题和字号下不重叠", Object.values(doubaoAudit).every(item => item.cardOverlaps.length === 0), doubaoAudit);
  check("豆包账号操作区始终位于卡片内部", Object.values(doubaoAudit).every(item => item.contained), doubaoAudit);
  check("豆包账号按钮之间不重叠", Object.values(doubaoAudit).every(item => item.noButtonOverlap), doubaoAudit);
  check("豆包账号卡片和账号栏无横向内容溢出", Object.values(doubaoAudit).every(item => item.noInternalOverflow && item.listOverflow <= truth.maximumOverflowPx && item.railOverflow <= truth.maximumOverflowPx), doubaoAudit);

  if (requireCanvas) {
    await cdp.evaluate("document.querySelector('[data-page=\"canvas\"]')?.click();true");
    const canvasReady = await waitFor(cdp.evaluate, "Boolean(document.querySelector('.lfc-stage') && document.querySelector('.lfc-viewport'))");
    check("无限画布独立模块已挂载", canvasReady);
    const canvasAudit = {};
    if (canvasReady) {
      for (const theme of truth.themes) {
        for (const fontSize of truth.fontSizes) {
          const key = theme + "/" + fontSize;
          await cdp.evaluate("window.lingframeAppearance.set(" + JSON.stringify({theme,fontSize}) + ")");
          await wait(90);
          canvasAudit[key] = await cdp.evaluate("(" + canvasProbe.toString() + ")()");
        }
      }
      const values = Object.values(canvasAudit);
      const buttonFonts = values.map(item => item.runButton?.fontSize).filter(Number.isFinite);
      const nodeFonts = values.map(item => item.nodeTitle?.fontSize).filter(Number.isFinite);
      const inspectorBackgrounds = values.map(item => item.right?.backgroundColor).filter(Boolean);
      const stable = list => list.length > 0 && Math.max(...list) - Math.min(...list) <= truth.canvasStableFontTolerancePx;
      const sidebarRatios = truth.themes.map(theme => ({
        theme,
        library: canvasAudit[theme + "/xlarge"]?.librarySmall?.fontSize / canvasAudit[theme + "/standard"]?.librarySmall?.fontSize,
        inspector: canvasAudit[theme + "/xlarge"]?.inspectorSmall?.fontSize / canvasAudit[theme + "/standard"]?.inspectorSmall?.fontSize,
        tab: canvasAudit[theme + "/xlarge"]?.inspectorTab?.fontSize / canvasAudit[theme + "/standard"]?.inspectorTab?.fontSize
      }));
      check("无限画布左右侧栏字号跟随系统设置", sidebarRatios.every(item => item.library >= truth.canvasSidebarMinimumScaleRatio && item.inspector >= truth.canvasSidebarMinimumScaleRatio && item.tab >= truth.canvasSidebarMinimumScaleRatio), {sidebarRatios,canvasAudit});
      check("无限画布节点和命令区字号保持稳定", stable(buttonFonts) && stable(nodeFonts), {buttonFonts,nodeFonts,canvasAudit});
      check("无限画布右侧检查器保持独立主题", new Set(inspectorBackgrounds).size === 1, {inspectorBackgrounds,canvasAudit});
      check("无限画布舞台保持独立可视区域", values.every(item => item.stage?.height >= truth.canvasMinimumStageHeightPx && item.stage.scrollWidth <= item.stage.clientWidth + truth.maximumOverflowPx && item.commandbar?.scrollWidth <= item.commandbar.clientWidth + truth.maximumOverflowPx), canvasAudit);
    }
  }

  await cdp.evaluate("(()=>{const saved=" + JSON.stringify(saved) + ";if(saved===null)localStorage.removeItem('lingframe.appearance.v1');else localStorage.setItem('lingframe.appearance.v1',saved);document.querySelector('[data-page=" + JSON.stringify(activePage) + "]')?.click();location.reload();return true})()");
  cdp.close();
  const failed = checks.filter(item => !item.ok);
  const report = {test:"appearance-module-isolation-runtime",timestamp:new Date().toISOString(),port,targetHint,requireCanvas,groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive:true});
  fs.writeFileSync(path.join(logDir, "appearance-module-isolation-runtime.json"), JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
  if (failed.length) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
