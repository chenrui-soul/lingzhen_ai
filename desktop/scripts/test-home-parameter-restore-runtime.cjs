"use strict";

const {app, BrowserWindow} = require("electron");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "home-parameter-restore-ground-truth.json"), "utf8"));
const requestedWidth = Number(process.env.HOME_PARAMETER_TEST_WIDTH || 0);
const viewports = requestedWidth ? truth.viewports.filter(item => item.width === requestedWidth) : [truth.viewports[0]];
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

function intersects(a, b) {
  const width = Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left));
  const height = Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
  return {width, height, area: width * height};
}

function writeReport(extra = {}) {
  const failed = checks.filter(item => !item.ok);
  const report = {test: "home-parameter-restore-runtime", timestamp: new Date().toISOString(), groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks, ...extra};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive: true});
  const suffix = requestedWidth || viewports[0]?.width || "runtime";
  fs.writeFileSync(path.join(logDir, `home-parameter-restore-${suffix}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  return failed.length;
}

app.whenReady().then(async () => {
  const screenshots = [];
  try {
    if (!viewports.length) throw new Error(`未配置测试窗口宽度：${requestedWidth}`);
    for (const viewport of viewports) {
      const window = new BrowserWindow({
        show: false,
        width: viewport.width,
        height: viewport.height,
        webPreferences: {
          preload: path.join(__dirname, "test-home-parameter-restore-preload.cjs"),
          partition: `home-parameter-restore-${viewport.width}-${Date.now()}`,
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      await window.loadFile(path.join(root, "src", "renderer", "index.html"));
      const ready = await waitFor(window, "Boolean(document.querySelector('.home-chat-shell [data-home-duration]') && document.querySelector('.desktop-settings'))");
      check(`参数工作台完成初始化:${viewport.width}`, ready);
      if (!ready) { window.destroy(); continue; }

      const doubao = await window.webContents.executeJavaScript(`(()=>{
        const channel=document.querySelector('[data-home-channel]');channel.value='doubao';channel.dispatchEvent(new Event('change',{bubbles:true}));
        const visible=selector=>{const node=document.querySelector(selector);return Boolean(node)&&getComputedStyle(node.closest('label')||node).display!=='none'};
        return {
          selectors:${JSON.stringify(truth.doubaoSelectors)}.map(selector=>({selector,found:Boolean(document.querySelector(selector)),visible:visible(selector)})),
          accounts:[...document.querySelector('[data-home-account-select]').options].map(option=>option.value),
          models:[...document.querySelector('[data-home-doubao-model]').options].map(option=>option.value),
          selectedModel:document.querySelector('[data-home-doubao-model]').value,
          duration:document.querySelector('[data-home-duration-output]').textContent,
          ratios:[...document.querySelector('[data-home-ratio]').options].map(option=>option.value),
          materialButtons:[...document.querySelectorAll('[data-home-asset-add]')].map(button=>button.dataset.homeAssetAdd)
        };
      })()`, true);
      check(`豆包账号与生成参数完整显示:${viewport.width}`, doubao.selectors.every(item => item.found && item.visible), doubao);
      check(`豆包支持自动调度和指定账号:${viewport.width}`, doubao.accounts.includes("__auto__") && doubao.accounts.includes("desktop-1"), doubao.accounts);
      check(`豆包模型、时长和比例保持原配置:${viewport.width}`, JSON.stringify(doubao.models) === JSON.stringify(truth.doubaoModels) && doubao.selectedModel === truth.doubaoDefaultModel && doubao.duration === truth.doubaoDefaultDuration && JSON.stringify(doubao.ratios) === JSON.stringify(truth.ratios), doubao);
      check(`四类素材入口完整显示:${viewport.width}`, JSON.stringify(doubao.materialButtons)===JSON.stringify(truth.homeAssetButtons), doubao);

      const gateway = await window.webContents.executeJavaScript(`(async()=>{
        const channel=document.querySelector('[data-home-channel]');channel.value='model-gateway';channel.dispatchEvent(new Event('change',{bubbles:true}));
        const type=document.querySelector('[data-home-model-type]');type.value='video';type.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(resolve=>setTimeout(resolve,80));
        const visible=selector=>{const node=document.querySelector(selector);return Boolean(node)&&getComputedStyle(node.closest('label')||node).display!=='none'};
        return {
          selectors:${JSON.stringify(truth.gatewaySelectors)}.map(selector=>({selector,found:Boolean(document.querySelector(selector)),visible:visible(selector)})),
          hiddenDoubao:['[data-home-group]','[data-home-account-select]','[data-home-doubao-model]','[data-home-duration]'].every(selector=>!visible(selector)),
          modelTypes:[...type.options].map(option=>option.value),
          selectedModel:document.querySelector('[data-home-model-select]').value,
          durations:[...document.querySelector('[data-home-gateway-duration]').options].map(option=>option.value),
          resolutions:[...document.querySelector('[data-home-gateway-resolution]').options].map(option=>option.value)
        };
      })()`, true);
      check(`模型网关对应参数完整显示:${viewport.width}`, gateway.selectors.every(item => item.found && item.visible) && gateway.hiddenDoubao, gateway);
      check(`模型类型和视频能力参数正确:${viewport.width}`, JSON.stringify(gateway.modelTypes) === JSON.stringify(truth.modelTypes) && gateway.selectedModel === "provider-test::video-model" && JSON.stringify(gateway.durations) === JSON.stringify(truth.videoDurations) && JSON.stringify(gateway.resolutions) === JSON.stringify(truth.videoResolutions), gateway);

      const layout = await window.webContents.executeJavaScript(`(()=>{
        const channel=document.querySelector('[data-home-channel]');channel.value='doubao';channel.dispatchEvent(new Event('change',{bubbles:true}));
        const rect=node=>{const value=node.getBoundingClientRect();return{left:value.left,top:value.top,right:value.right,bottom:value.bottom,width:value.width,height:value.height}};
        return {submit:rect(document.querySelector('[data-home-submit]')),status:rect(document.querySelector('.desktop-settings')),viewport:{width:innerWidth,height:innerHeight},statusTextDisplay:getComputedStyle(document.querySelector('.desktop-settings span')).display};
      })()`, true);
      const overlap = intersects(layout.submit, layout.status);
      const maxStatusWidth = viewport.width <= 1100 ? truth.maximumStatusBarWidthCompact : truth.maximumStatusBarWidthLarge;
      check(`授权状态条不遮挡开始创作:${viewport.width}`, overlap.area <= truth.maximumAllowedOverlapPx, {layout, overlap});
      check(`授权状态条宽度受控:${viewport.width}`, layout.status.width <= maxStatusWidth + 1, layout);

      const screenshot = path.join(root, "scripts", "log", `home-parameter-restore-${viewport.width}x${viewport.height}.png`);
      fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
      screenshots.push(screenshot);
      window.destroy();
    }
    process.exitCode = writeReport({screenshots});
  } catch (error) {
    console.error(error.stack || error);
    process.exitCode = writeReport({fatal: String(error.stack || error), screenshots});
  } finally {
    app.quit();
  }
}).catch(error => { console.error(error.stack || error); process.exitCode = writeReport({fatal: String(error.stack || error)}); app.quit(); });
