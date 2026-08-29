"use strict";

const {app, BrowserWindow} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "desktop-responsive-layout-ground-truth.json"), "utf8"));
const checks = [];
const screenshots = [];
const messages = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, ok, detail=null) => checks.push({name, ok:Boolean(ok), detail});
app.setPath("userData", path.join(os.tmpdir(), `lingframe-responsive-ui-${process.pid}`));
app.commandLine.appendSwitch("disable-gpu");

async function waitFor(win, expression, timeout=12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression, true)) return true;
    await wait(60);
  }
  return false;
}

async function probe(win) {
  return win.webContents.executeJavaScript(`(()=>{const box=s=>{const n=document.querySelector(s);if(!n)return null;const r=n.getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height,clientWidth:n.clientWidth,scrollWidth:n.scrollWidth,clientHeight:n.clientHeight,scrollHeight:n.scrollHeight}};const shell=document.querySelector('.shell');return{viewport:{width:innerWidth,height:innerHeight},mode:shell?.dataset.layout,page:shell?.dataset.currentPage,documentOverflow:{x:document.documentElement.scrollWidth-innerWidth,y:document.documentElement.scrollHeight-innerHeight},shell:box('.shell'),sidebar:box('.sidebar'),workspace:box('.workspace'),right:box('.right'),prompt:box('.home-prompt-editor'),homeShell:box('.home-chat-shell'),taskLayout:box('.task-center-layout'),textWorkspace:box('.text-workspace'),resourceLibrary:box('.resource-library'),rightOff:shell?.classList.contains('right-off'),leftOff:shell?.classList.contains('left-off'),textNarrow:document.querySelector('.text-workspace')?.classList.contains('is-narrow')||false,taskColumns:document.querySelector('.task-center-layout')?getComputedStyle(document.querySelector('.task-center-layout')).gridTemplateColumns:'',bodyOverflow:{x:document.body.scrollWidth-innerWidth,y:document.body.scrollHeight-innerHeight}}})()`, true);
}

async function openPage(win, page) {
  await win.webContents.executeJavaScript(`document.querySelector('[data-page=${JSON.stringify(page)}]')?.click(); true`, true);
  await wait(450);
}

app.whenReady().then(async () => {
  const keeper = new BrowserWindow({show:false,width:1,height:1,skipTaskbar:true});
  try {
    for (const viewport of truth.viewports) {
      const win = new BrowserWindow({show:false,width:viewport.width,height:viewport.height,minWidth:800,minHeight:560,webPreferences:{preload:path.join(__dirname,"test-desktop-responsive-runtime-preload.cjs"),partition:`responsive-${viewport.width}-${Date.now()}`,contextIsolation:true,nodeIntegration:false}});
      win.webContents.on("console-message", (_, level, message) => messages.push({viewport:viewport.width,level,message}));
      await win.loadFile(path.join(root, "src", "renderer", "index.html"));
      const ready = await waitFor(win, "Boolean(document.querySelector('.shell[data-layout]')&&!document.querySelector('.auth-gate')&&!document.querySelector('.license-gate'))");
      check(`工作台完成初始化:${viewport.width}`, ready);
      if (!ready) { win.destroy(); continue; }

      await openPage(win, "home");
      const home = await probe(win);
      check(`布局档位正确:${viewport.width}`, home.mode === viewport.mode, home);
      check(`首页无页面级溢出:${viewport.width}`, home.documentOverflow.x <= truth.maximumDocumentOverflow && home.bodyOverflow.x <= truth.maximumDocumentOverflow, home);
      check(`首页主工作区保持可用:${viewport.width}`, home.workspace?.width >= truth.minimumWorkspaceWidth, home);
      check(`首页提示词区域保持可用:${viewport.width}`, home.prompt?.width >= truth.minimumHomePromptWidth, home);
      if (viewport.mode === "compact") check("1280 使用紧凑导航", home.sidebar?.width <= truth.compactNavigationWidth && home.sidebar.scrollWidth <= home.sidebar.clientWidth + 1, home);
      if (viewport.mode === "minimal") check("1120 自动收起右栏", home.rightOff && home.sidebar?.width >= truth.minimumNavigationWidth && home.sidebar?.width <= truth.maximumNavigationWidth && home.sidebar.scrollWidth <= home.sidebar.clientWidth + 1, home);
      const homeShot = path.join(root, "scripts", "log", `desktop-responsive-home-${viewport.width}x${viewport.height}.png`);
      fs.writeFileSync(homeShot, (await win.webContents.capturePage()).toPNG()); screenshots.push(homeShot);

      await openPage(win, "tasks");
      const tasks = await probe(win);
      check(`任务中心无页面级溢出:${viewport.width}`, tasks.documentOverflow.x <= truth.maximumDocumentOverflow, tasks);
      if (viewport.width <= 1280) check(`任务中心按容器切为上下布局:${viewport.width}`, tasks.taskColumns.split(" ").length === 1, tasks);
      const taskShot = path.join(root, "scripts", "log", `desktop-responsive-tasks-${viewport.width}x${viewport.height}.png`);
      fs.writeFileSync(taskShot, (await win.webContents.capturePage()).toPNG()); screenshots.push(taskShot);

      await openPage(win, "text");
      if (!await waitFor(win, "Boolean(document.querySelector('.text-workspace'))", 4000)) { check(`文本工作区加载:${viewport.width}`, false); }
      else {
        const textLayout = await probe(win);
        check(`文本创作无页面级溢出:${viewport.width}`, textLayout.documentOverflow.x <= truth.maximumDocumentOverflow, textLayout);
        if (viewport.width <= 1280) check(`文本创作先收起辅助栏:${viewport.width}`, textLayout.textNarrow, textLayout);
        const textShot = path.join(root, "scripts", "log", `desktop-responsive-text-${viewport.width}x${viewport.height}.png`);
        fs.writeFileSync(textShot, (await win.webContents.capturePage()).toPNG()); screenshots.push(textShot);
      }

      await openPage(win, "resources");
      const resources = await probe(win);
      check(`资源库无页面级溢出:${viewport.width}`, resources.documentOverflow.x <= truth.maximumDocumentOverflow, resources);
      const resourceShot = path.join(root, "scripts", "log", `desktop-responsive-resources-${viewport.width}x${viewport.height}.png`);
      fs.writeFileSync(resourceShot, (await win.webContents.capturePage()).toPNG()); screenshots.push(resourceShot);

      if (viewport.mode === "minimal") {
        await openPage(win, "home");
        await win.webContents.executeJavaScript("document.querySelector('#right-panel-toggle')?.click(); true", true);
        await wait(260);
        const drawer = await probe(win);
        check("最小窗口右栏并排展开且不遮挡", !drawer.rightOff && drawer.workspace?.width >= truth.minimumWorkspaceWidth && drawer.right?.left >= drawer.workspace?.right - 1, drawer);
      }
      win.destroy();
    }
  } catch (error) {
    checks.push({name:"运行时验收完成",ok:false,detail:String(error.stack||error)});
  } finally {
    keeper.destroy();
    const failed = checks.filter(item => !item.ok);
    const report = {test:"desktop-responsive-runtime",total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks,screenshots,messages,generatedAt:new Date().toISOString()};
    const logDir = path.join(root, "scripts", "log"); fs.mkdirSync(logDir,{recursive:true});
    fs.writeFileSync(path.join(logDir,"desktop-responsive-runtime.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    process.exitCode = failed.length ? 1 : 0;
    app.quit();
  }
}).catch(error => { console.error(error.stack||error); process.exitCode=1; app.quit(); });
