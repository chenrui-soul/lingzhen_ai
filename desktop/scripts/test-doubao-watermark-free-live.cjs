"use strict";

const fs = require("fs");
const path = require("path");
const {app, BrowserWindow, net} = require("electron");
const {resolveDoubaoWatermarkFreeVideo} = require("../src/main/doubao-watermark-free-resolver.cjs");

const [tenantId, accountId, conversationId, videoVid, backfillTaskId = ""] = process.argv.slice(2);
const userData = process.env.LINGFRAME_LIVE_USER_DATA || path.join(process.env.APPDATA || "", "灵帧AI");
const logPath = path.join(__dirname, "log", "doubao-watermark-free-live.json");

function safePart(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80) || "unknown";
}

function publicUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

async function verifySignedVideo(url) {
  const response = await net.fetch(url, {headers: {Accept: "video/*,*/*;q=0.8", Range: "bytes=0-65535"}});
  if (!response.ok && response.status !== 206) throw new Error(`视频地址验证失败（HTTP ${response.status}）`);
  const reader = response.body?.getReader();
  const first = reader ? await reader.read() : {value: new Uint8Array(await response.arrayBuffer())};
  await reader?.cancel().catch(() => {});
  const bytes = Number(first.value?.byteLength || 0);
  if (!bytes) throw new Error("视频地址返回了空响应");
  return {status: response.status, contentType: response.headers.get("content-type") || "", sampledBytes: bytes};
}

function backfillTaskSources({resultUrl, resolved}) {
  if (!backfillTaskId) return null;
  const databasePath = path.join(userData, "tenants", tenantId, "database", "workbench-data-v1.json");
  const database = JSON.parse(fs.readFileSync(databasePath, "utf8"));
  const task = (database.tasks || []).find(item => item.id === backfillTaskId && !item.deletedAt);
  if (!task) throw new Error(`待补齐双地址的任务不存在：${backfillTaskId}`);
  if (task.executionChannel !== "doubao" || task.state !== "completed") throw new Error("只允许补齐已完成豆包任务的双地址");
  if (String(task.accountId || "") !== accountId || String(task.conversationId || "") !== conversationId || String(task.videoVid || "") !== videoVid) throw new Error("任务账号、会话或视频 VID 与真实解析参数不一致");
  const existingResult = String(task.resultVid || "").trim();
  const existingFallback = String(task.fallbackResultVid || "").trim();
  const pageUrl = existingFallback || existingResult;
  if (!/^https?:\/\//i.test(pageUrl)) throw new Error("历史任务缺少可保留的豆包页面视频地址");
  if (pageUrl === resultUrl) throw new Error("无水印地址与页面地址相同，已停止写回");
  const timestamp = new Date().toISOString();
  const backupPath = `${databasePath}.before-dual-url-${timestamp.replace(/[:.]/g, "-")}.bak`;
  fs.copyFileSync(databasePath, backupPath);
  task.resultVid = resultUrl;
  task.resultUrls = [resultUrl];
  task.resultUrlSource = "doubao-aispace-watermark-free";
  task.watermarkFree = true;
  task.watermarkFreeError = "";
  task.resultSourceResolvedAt = resolved.resolvedAt || timestamp;
  task.fallbackResultVid = pageUrl;
  task.updatedAt = timestamp;
  task.steps = Array.isArray(task.steps) ? task.steps : [];
  task.steps.push({at: timestamp, state: "completed", message: "已补齐豆包无水印源地址与页面有水印地址"});
  const temporaryPath = `${databasePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(database, null, 2)}\n`, "utf8");
  fs.renameSync(temporaryPath, databasePath);
  return {taskId: task.id, backupPath, pageUrl: publicUrl(pageUrl), watermarkFreeUrl: publicUrl(resultUrl)};
}

async function main() {
  if (!tenantId || !accountId || !conversationId || !videoVid) throw new Error("用法：electron test-doubao-watermark-free-live.cjs <tenantId> <accountId> <conversationId> <videoVid>");
  app.setPath("userData", path.resolve(userData));
  await app.whenReady();
  const partition = `persist:lingframe_${safePart(tenantId)}_doubao_${safePart(accountId)}`;
  const window = new BrowserWindow({show: false, webPreferences: {partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false}});
  try {
    await window.loadURL(`https://www.doubao.com/chat/${encodeURIComponent(conversationId)}`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    const page = await window.webContents.executeJavaScript("({hostname:location.hostname,path:location.pathname,title:document.title})");
    const resolved = await resolveDoubaoWatermarkFreeVideo({
      videoVid,
      conversationId,
      evaluate: expression => window.webContents.executeJavaScript(expression, true),
    });
    const selectedUrl = resolved.mainUrl || resolved.backupUrl;
    const verification = await verifySignedVideo(selectedUrl);
    const backfill = backfillTaskSources({resultUrl: selectedUrl, resolved});
    const report = {
      test: "doubao-watermark-free-live",
      testedAt: new Date().toISOString(),
      ok: true,
      tenantId,
      accountId,
      conversationId,
      videoVid,
      partition,
      page,
      source: resolved.source,
      selected: resolved.mainUrl ? "main_url" : "backup_url",
      publicUrl: publicUrl(selectedUrl),
      node: resolved.node,
      resultPage: resolved.page,
      resolvedAt: resolved.resolvedAt,
      verification,
      backfill,
    };
    fs.mkdirSync(path.dirname(logPath), {recursive: true});
    fs.writeFileSync(logPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } finally {
    if (!window.isDestroyed()) window.destroy();
  }
}

main().catch(error => {
  const report = {test: "doubao-watermark-free-live", testedAt: new Date().toISOString(), ok: false, tenantId, accountId, conversationId, videoVid, code: String(error?.code || "LIVE_TEST_FAILED"), error: String(error?.message || error)};
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.error(JSON.stringify(report, null, 2));
  process.exitCode = 1;
}).finally(() => app.quit());
