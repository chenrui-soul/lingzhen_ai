"use strict";

const {app, BrowserWindow} = require("electron");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "desktop-bootstrap-loading-ground-truth.json"), "utf8"));
const checks = [];
const screenshots = [];
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const check = (name, ok, detail=null) => checks.push({name,ok:Boolean(ok),detail});
app.setPath("userData", path.join(os.tmpdir(), `lingframe-bootstrap-loading-runtime-${process.pid}`));
app.commandLine.appendSwitch("disable-gpu");

async function waitFor(win, expression, timeout=12000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await win.webContents.executeJavaScript(expression, true)) return true;
    await wait(60);
  }
  return false;
}

async function openHarness() {
  const win = new BrowserWindow({show:false,width:1120,height:700,minWidth:800,minHeight:560,webPreferences:{contextIsolation:false,nodeIntegration:false}});
  await win.loadFile(path.join(root, "references", "desktop-bootstrap-loading-harness.html"));
  return win;
}

app.whenReady().then(async()=>{
  const keeper = new BrowserWindow({show:false,width:1,height:1,skipTaskbar:true});
  try {
    const readyWindow = await openHarness();
    const delayed = await waitFor(readyWindow, "Boolean(document.querySelector('.auth-loading-delayed'))", truth.slowNoticeMs + 2500);
    check("slow request becomes an actionable delayed state", delayed);
    if (delayed) {
      const probe = await readyWindow.webContents.executeJavaScript(`(()=>({text:document.querySelector('#auth-gate')?.innerText||'',retry:Boolean(document.querySelector('[data-bootstrap-retry-slow]')),wait:Boolean(document.querySelector('[data-bootstrap-wait]')),overflow:document.documentElement.scrollWidth-innerWidth}))()`, true);
      check("delayed state copy and controls are complete", truth.requiredCopy.every(value=>probe.text.includes(value)) && probe.retry && probe.wait, probe);
      check("delayed state has no horizontal overflow", probe.overflow <= truth.maximumDocumentOverflowPx, probe);
      const shot = path.join(root,"scripts","log","desktop-bootstrap-loading-delayed.png");
      fs.writeFileSync(shot,(await readyWindow.webContents.capturePage()).toPNG());screenshots.push(shot);
      await readyWindow.webContents.executeJavaScript("window.__bootstrapHarness.emitReady();true", true);
      check("ready auth event closes the gate without waiting for the original request", await waitFor(readyWindow, "!document.querySelector('#auth-gate')", 1500));
    }
    readyWindow.destroy();

    const retryWindow = await openHarness();
    const retryDelayed = await waitFor(retryWindow, "Boolean(document.querySelector('[data-bootstrap-retry-slow]'))", truth.slowNoticeMs + 2500);
    check("manual retry is shown after the slow threshold", retryDelayed);
    if (retryDelayed) {
      await retryWindow.webContents.executeJavaScript("document.querySelector('[data-bootstrap-retry-slow]').click();true", true);
      await wait(80);
      const retryProbe = await retryWindow.webContents.executeJavaScript(`(()=>({calls:window.__bootstrapHarness.stats().bootstrapCalls,leaving:Boolean(document.querySelector('#auth-gate.is-leaving'))}))()`, true);
      check("manual retry invokes bootstrap exactly once and enters the workspace", retryProbe.calls === 1 && retryProbe.leaving, retryProbe);
    }
    retryWindow.destroy();
  } catch (error) {
    checks.push({name:"runtime acceptance completes",ok:false,detail:String(error.stack||error)});
  } finally {
    keeper.destroy();
    const failed = checks.filter(item=>!item.ok);
    const report={test:`${truth.test}-runtime`,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks,screenshots,generatedAt:new Date().toISOString()};
    const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});
    fs.writeFileSync(path.join(logDir,"desktop-bootstrap-loading-runtime.json"),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report,null,2));
    process.exitCode=failed.length?1:0;
    app.quit();
  }
}).catch(error=>{console.error(error.stack||error);process.exitCode=1;app.quit();});
