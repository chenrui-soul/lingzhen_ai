"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {BrowserController} = require("../src/main/browser-controller.cjs");
const {VideoDownloader} = require("../src/main/video-downloader.cjs");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-batch4-video-"));
const controller = new BrowserController({profileRootProvider: () => path.join(root, "tenant-a", "chrome-profiles"), testMode: true});
const downloader = controller.downloader;

(async () => {
  const firstSubmitted = await controller.execute({id: "cmd-a", action: "generate", account: {id: "account-a", platform: "豆包"}, payload: {jobId: "job-a", prompt: "红色气球"}});
  const secondSubmitted = await controller.execute({id: "cmd-b", action: "generate", account: {id: "account-b", platform: "豆包"}, payload: {jobId: "job-b", prompt: "蓝色汽车"}});
  assert.equal(firstSubmitted.generating, true);
  assert.equal(secondSubmitted.generating, true);
  const first = await controller.execute({id: "cmd-a", action: "monitor", account: {id: "account-a", platform: "豆包"}, payload: {jobId: "job-a", prompt: "红色气球", conversationId:firstSubmitted.conversationId}});
  const second = await controller.execute({id: "cmd-b", action: "monitor", account: {id: "account-b", platform: "豆包"}, payload: {jobId: "job-b", prompt: "蓝色汽车", conversationId:secondSubmitted.conversationId}});
  assert.equal(first.state, "completed");
  assert.equal(second.state, "completed");
  assert.notEqual(first.videoUrl, second.videoUrl);
  assert.notEqual(first.resultPath, second.resultPath);
  assert.equal(first.downloadAudit.verified, true);
  assert.equal(second.downloadAudit.verified, true);
  assert.ok(fs.existsSync(first.resultPath));
  assert.ok(fs.existsSync(second.resultPath));
  const bad = path.join(root, "bad.bin");
  fs.writeFileSync(bad, Buffer.alloc(70000, 1));
  assert.throws(() => downloader.verify(bad), /MP4/);
  const report = {test: "video-capture-isolation", passed: 10, failed: 0, jobs: [{id: "job-a", url: first.videoUrl, path: first.resultPath}, {id: "job-b", url: second.videoUrl, path: second.resultPath}]};
  const logDir = path.join(__dirname, "log"); fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, "video-capture-isolation.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  controller.closeAll();
})().catch(error => { console.error(error); process.exit(1); });
