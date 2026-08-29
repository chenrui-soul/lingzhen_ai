"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const {spawn, spawnSync} = require("child_process");

const root = path.resolve(__dirname, "..");
const electron = path.join(root, "node_modules", "electron", "dist", "electron.exe");
const userData = path.join(root, ".local-user-data-project-resource-s3-20260817-125045");
const port = 9578;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks))); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.setTimeout(1200, () => request.destroy(new Error("timeout")));
  });
}

async function ready() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await getJson(`http://127.0.0.1:${port}/json/list`)).length) return true; }
    catch {}
    await wait(250);
  }
  throw new Error("S3 对比度隔离实例未就绪");
}

function stop(child) {
  if (child?.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {windowsHide:true, stdio:"ignore"});
}

(async () => {
  const activePort = path.join(userData, "DevToolsActivePort");
  if (fs.existsSync(activePort)) fs.rmSync(activePort, {force:true});
  const env = {
    ...process.env,
    LINGFRAME_SMOKE_ALLOW_SECOND_INSTANCE:"1",
    LINGFRAME_TEST_USER_DATA:userData,
    LINGFRAME_CDP_PORT:String(port),
    LINGFRAME_TARGET_HINT:"src/renderer/index.html"
  };
  const child = spawn(electron, [".", `--remote-debugging-port=${port}`, "--no-sandbox"], {cwd:root, windowsHide:true, stdio:"ignore", env});
  try {
    await ready();
    const definitions = [
      ["ui-text-contrast-runtime", "scripts/test-ui-text-contrast-runtime.cjs", "scripts/log/ui-text-contrast-runtime.json"],
      ["appearance-module-isolation-runtime", "scripts/test-appearance-module-isolation-runtime.cjs", "scripts/log/appearance-module-isolation-runtime.json"]
    ];
    const suites = [];
    for (const [name, script, reportPath] of definitions) {
      const entry = path.join(root, script);
      const run = spawnSync(process.execPath, ["-e", `global.WebSocket=require("undici").WebSocket;require(${JSON.stringify(entry)})`], {cwd:root, env, windowsHide:true, encoding:"utf8", timeout:180000});
      let report;
      try { report = JSON.parse(fs.readFileSync(path.join(root, reportPath), "utf8")); }
      catch { report = null; }
      suites.push({name, script, ok:run.status === 0, exitCode:run.status, total:Number(report?.total || 0), passed:Number(report?.passed || 0), failed:Number(report?.failed || 0), stderr:String(run.stderr || "").trim()});
    }
    const total = suites.reduce((sum, item) => sum + item.total, 0);
    const passed = suites.reduce((sum, item) => sum + item.passed, 0);
    const report = {test:"project-resource-accessibility-s3-contrast", timestamp:new Date().toISOString(), port, total, passed, failed:total-passed, suites, ok:suites.every(item => item.ok) && passed === total};
    fs.writeFileSync(path.join(root, "scripts", "log", "project-resource-accessibility-s3-contrast.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report, null, 2));
    if (!report.ok) process.exitCode = 1;
  } finally {
    stop(child);
  }
})().catch(error => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exit(1);
});
