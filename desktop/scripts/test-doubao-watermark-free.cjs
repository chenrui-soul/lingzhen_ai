"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  resolveDoubaoWatermarkFreeInPage,
  resolveDoubaoWatermarkFreeVideo,
  isTrustedDoubaoVideoUrl,
} = require("../src/main/doubao-watermark-free-resolver.cjs");
const {BrowserController} = require("../src/main/browser-controller.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "doubao-watermark-free-ground-truth.json");
const logPath = path.join(root, "scripts", "log", "doubao-watermark-free.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const results = [];

async function check(name, action) {
  try {
    await action();
    results.push({name, ok: true});
  } catch (error) {
    results.push({name, ok: false, error: String(error.stack || error)});
  }
}

function response(status, payload) {
  return {ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(payload)};
}

function homepage() {
  return {code: 0, data: {children: [{id: "creation-root", name: "我的创作"}]}};
}

function videoNode(overrides = {}) {
  return {
    id: truth.creationNodeId,
    key: truth.videoVid,
    name: "video.mp4",
    node_type: 6,
    size: 33446733,
    conversation_id: truth.conversationId,
    content: {message_id_str: truth.messageId},
    ...overrides,
  };
}

async function withPageFetch(handler, action) {
  const previousFetch = global.fetch;
  const previousLocation = global.location;
  global.fetch = handler;
  global.location = {hostname: "www.doubao.com"};
  try { return await action(); }
  finally {
    global.fetch = previousFetch;
    if (previousLocation === undefined) delete global.location;
    else global.location = previousLocation;
  }
}

function requestBody(options) {
  return JSON.parse(String(options?.body || "{}"));
}

async function pageResolution(nodePages) {
  const calls = [];
  const value = await withPageFetch(async (url, options) => {
    const endpoint = String(url).split("?")[0];
    calls.push({endpoint, body: requestBody(options)});
    if (endpoint.endsWith("/homepage")) return response(200, homepage());
    if (endpoint.endsWith("/node_info")) {
      const index = calls.filter(item => item.endpoint.endsWith("/node_info")).length - 1;
      return response(200, {code: 0, data: nodePages[index] || {children: []}});
    }
    if (endpoint.endsWith("/get_download_info")) return response(200, {code: 0, data: {download_infos: [{main_url: truth.urls.main, backup_url: truth.urls.backup}]}});
    return response(404, {});
  }, () => resolveDoubaoWatermarkFreeInPage({videoVid: truth.videoVid, conversationId: truth.conversationId, maxPages: 5}));
  return {value, calls};
}

function controllerHarness(resolveImpl, downloadImpl) {
  const controller = new BrowserController({profileRootProvider: () => os.tmpdir(), downloadRootProvider: () => os.tmpdir(), testMode: false});
  controller.resolveWatermarkFreeVideo = resolveImpl;
  controller.connect = async () => ({send: async () => ({cookies: []})});
  controller.downloader.download = downloadImpl;
  return controller;
}

(async () => {
  await check("homepage 正常且 node_info 第一页按 VID/会话精确匹配", async () => {
    const {value, calls} = await pageResolution([{children: [videoNode()], has_more: false}]);
    assert.equal(value.ok, true);
    assert.equal(value.node.key, truth.videoVid);
    assert.equal(value.node.conversationId, truth.conversationId);
    assert.deepEqual(calls.find(item => item.endpoint.endsWith("/node_info")).body.sort_param, {need_sort_config: true, sort_order: 1, sort_type: 0});
  });

  await check("node_info 使用 cursor 在第二页找到目标", async () => {
    const {value, calls} = await pageResolution([
      {children: [videoNode({key: "other-video"})], has_more: true, next_cursor: "cursor-2"},
      {children: [videoNode()], has_more: false},
    ]);
    assert.equal(value.ok, true);
    const nodeCalls = calls.filter(item => item.endpoint.endsWith("/node_info"));
    assert.equal(nodeCalls.length, 2);
    assert.equal(nodeCalls[1].body.cursor, "cursor-2");
  });

  await check("生产页面表达式可独立执行并返回可信地址", async () => {
    const resolved = await withPageFetch(async (url) => {
      const endpoint = String(url).split("?")[0];
      if (endpoint.endsWith("/homepage")) return response(200, homepage());
      if (endpoint.endsWith("/node_info")) return response(200, {code: 0, data: {children: [videoNode()], has_more: false}});
      return response(200, {code: 0, data: {download_infos: [{main_url: truth.urls.main, backup_url: truth.urls.backup}]}});
    }, () => resolveDoubaoWatermarkFreeVideo({
      videoVid: truth.videoVid,
      conversationId: truth.conversationId,
      evaluate: async expression => eval(expression),
    }));
    assert.equal(resolved.mainUrl, truth.urls.main);
    assert.equal(resolved.backupUrl, truth.urls.backup);
  });

  await check("VID 不匹配返回结构化未找到错误", async () => {
    const {value} = await pageResolution([{children: [videoNode({key: "different-video"})], has_more: false}]);
    assert.equal(value.ok, false);
    assert.equal(value.code, "DOUBAO_AISPACE_VIDEO_NOT_FOUND");
  });

  await check("conversationId 不匹配时拒绝串任务", async () => {
    const {value} = await pageResolution([{children: [videoNode({conversation_id: "foreign-conversation"})], has_more: false}]);
    assert.equal(value.ok, false);
    assert.equal(value.code, "DOUBAO_AISPACE_CONVERSATION_MISMATCH");
  });

  await check("401/403 不绕过且不重试", async () => {
    let calls = 0;
    const value = await withPageFetch(async () => { calls += 1; return response(403, {code: 0}); }, () => resolveDoubaoWatermarkFreeInPage({videoVid: truth.videoVid, conversationId: truth.conversationId}));
    assert.equal(value.code, "DOUBAO_AISPACE_AUTH_REQUIRED");
    assert.equal(calls, 1);
  });

  await check("429 有限退避后恢复", async () => {
    let homepageCalls = 0;
    const value = await withPageFetch(async (url) => {
      const endpoint = String(url).split("?")[0];
      if (endpoint.endsWith("/homepage")) {
        homepageCalls += 1;
        return homepageCalls < 3 ? response(429, {}) : response(200, homepage());
      }
      if (endpoint.endsWith("/node_info")) return response(200, {code: 0, data: {children: [videoNode()], has_more: false}});
      return response(200, {code: 0, data: {download_infos: [{main_url: truth.urls.main}]}});
    }, () => resolveDoubaoWatermarkFreeInPage({videoVid: truth.videoVid, conversationId: truth.conversationId}));
    assert.equal(value.ok, true);
    assert.equal(homepageCalls, 3);
  });

  await check("仅接受可信 HTTPS 豆包/抖音视频域名", async () => {
    assert.equal(isTrustedDoubaoVideoUrl(truth.urls.main), true);
    assert.equal(isTrustedDoubaoVideoUrl(truth.urls.page), true);
    assert.equal(isTrustedDoubaoVideoUrl(truth.urls.untrusted), false);
    await assert.rejects(() => resolveDoubaoWatermarkFreeVideo({videoVid: truth.videoVid, conversationId: truth.conversationId, evaluate: async () => ({ok: true, mainUrl: truth.urls.untrusted, backupUrl: ""})}), error => error.code === "DOUBAO_AISPACE_UNTRUSTED_URL");
  });

  await check("main_url 成功时标记为无水印源", async () => {
    const calls = [];
    const controller = controllerHarness(async () => ({mainUrl: truth.urls.main, backupUrl: truth.urls.backup, resolvedAt: "2026-08-20T00:00:00.000Z"}), async resource => { calls.push(resource.url); return {resultPath: "main.mp4", downloadAudit: {verified: true}}; });
    const result = await controller.downloadDoubaoVideoWithFallback({testMode: false}, {url: truth.urls.page}, {jobId: "main", videoVid: truth.videoVid, conversationId: truth.conversationId});
    assert.deepEqual(calls, [truth.urls.main]);
    assert.equal(result.watermarkFree, true);
    assert.equal(result.resultUrlCandidate, "main_url");
    assert.equal(result.fallbackResultVid, truth.urls.page);
  });

  await check("main_url 失败后使用 backup_url", async () => {
    const calls = [];
    const controller = controllerHarness(async () => ({mainUrl: truth.urls.main, backupUrl: truth.urls.backup}), async resource => { calls.push(resource.url); if (resource.url === truth.urls.main) throw new Error("expired"); return {resultPath: "backup.mp4", downloadAudit: {verified: true}}; });
    const result = await controller.downloadDoubaoVideoWithFallback({testMode: false}, {url: truth.urls.page}, {jobId: "backup", videoVid: truth.videoVid, conversationId: truth.conversationId});
    assert.deepEqual(calls, [truth.urls.main, truth.urls.backup]);
    assert.equal(result.watermarkFree, true);
    assert.equal(result.resultUrlCandidate, "backup_url");
  });

  await check("无水印接口失败后自动降级页面地址", async () => {
    const calls = [];
    const controller = controllerHarness(async () => { throw Object.assign(new Error("not found"), {code: "DOUBAO_AISPACE_VIDEO_NOT_FOUND"}); }, async resource => { calls.push(resource.url); return {resultPath: "page.mp4", downloadAudit: {verified: true}}; });
    const result = await controller.downloadDoubaoVideoWithFallback({testMode: false}, {url: truth.urls.page}, {jobId: "page", videoVid: truth.videoVid, conversationId: truth.conversationId});
    assert.deepEqual(calls, [truth.urls.page]);
    assert.equal(result.watermarkFree, false);
    assert.equal(result.resultUrlSource, "doubao-page-fallback");
    assert.match(result.watermarkFreeError, /VIDEO_NOT_FOUND/);
  });

  await check("无水印两个地址下载失败后自动降级页面地址", async () => {
    const calls = [];
    const controller = controllerHarness(async () => ({mainUrl: truth.urls.main, backupUrl: truth.urls.backup}), async resource => { calls.push(resource.url); if (resource.url !== truth.urls.page) throw new Error("download failed"); return {resultPath: "page.mp4", downloadAudit: {verified: true}}; });
    const result = await controller.downloadDoubaoVideoWithFallback({testMode: false}, {url: truth.urls.page}, {jobId: "download-fallback", videoVid: truth.videoVid, conversationId: truth.conversationId});
    assert.deepEqual(calls, [truth.urls.main, truth.urls.backup, truth.urls.page]);
    assert.equal(result.watermarkFree, false);
  });

  await check("旧签名失效时重新回传会凭 VID 获取新签名", async () => {
    let generationCalls = 0;
    let resolved = 0;
    const controller = controllerHarness(async (_session, {videoVid}) => { resolved += 1; assert.equal(videoVid, truth.videoVid); return {mainUrl: `${truth.urls.main}&refresh=${resolved}`, backupUrl: ""}; }, async resource => {
      if (!resource.url.includes("refresh=")) throw new Error("old signature used");
      return {resultPath: `refresh-${resolved}.mp4`, downloadAudit: {verified: true}};
    });
    controller.runGeneration = async () => { generationCalls += 1; };
    const first = await controller.downloadDoubaoVideoWithFallback({testMode: false}, {url: `${truth.urls.page}&old=1`}, {jobId: "refresh-1", videoVid: truth.videoVid, conversationId: truth.conversationId});
    const second = await controller.downloadDoubaoVideoWithFallback({testMode: false}, {url: `${truth.urls.page}&old=1`}, {jobId: "refresh-2", videoVid: truth.videoVid, conversationId: truth.conversationId});
    assert.notEqual(first.videoUrl, second.videoUrl);
    assert.equal(resolved, 2);
    assert.equal(generationCalls, 0);
  });

  await check("多任务乱序回传不会串 VID", async () => {
    const associations = [];
    const controller = controllerHarness(async (_session, {videoVid}) => {
      await new Promise(resolve => setTimeout(resolve, videoVid.endsWith("a") ? 20 : 1));
      return {mainUrl: `https://v11-videoweb-download.doubao.com/${videoVid}.mp4`, backupUrl: ""};
    }, async (resource, {jobId}) => { associations.push({jobId, url: resource.url}); return {resultPath: `${jobId}.mp4`, downloadAudit: {verified: true}}; });
    await Promise.all([
      controller.downloadDoubaoVideoWithFallback({testMode: false, account: {id: "account-a"}}, {url: truth.urls.page}, {jobId: "task-a", videoVid: "video_vid_a", conversationId: "conv-a"}),
      controller.downloadDoubaoVideoWithFallback({testMode: false, account: {id: "account-b"}}, {url: truth.urls.page}, {jobId: "task-b", videoVid: "video_vid_b", conversationId: "conv-b"}),
    ]);
    assert.equal(associations.find(item => item.jobId === "task-a").url.endsWith("/video_vid_a.mp4"), true);
    assert.equal(associations.find(item => item.jobId === "task-b").url.endsWith("/video_vid_b.mp4"), true);
  });

  await check("不同账号解析始终使用传入的原账号会话", async () => {
    const accounts = [];
    const controller = controllerHarness(async function ({videoVid}) { accounts.push(this?.account?.id || videoVid); return {mainUrl: `https://v11-videoweb-download.doubao.com/${videoVid}.mp4`, backupUrl: ""}; }, async (resource, {jobId}) => ({resultPath: `${jobId}.mp4`, downloadAudit: {verified: true}, resource}));
    controller.resolveWatermarkFreeVideo = async (session, {videoVid}) => { accounts.push(session.account.id); return {mainUrl: `https://v11-videoweb-download.doubao.com/${videoVid}.mp4`, backupUrl: ""}; };
    await controller.downloadDoubaoVideoWithFallback({testMode: false, account: {id: "account-a"}}, {url: truth.urls.page}, {jobId: "account-a", videoVid: "account_video_a"});
    await controller.downloadDoubaoVideoWithFallback({testMode: false, account: {id: "account-b"}}, {url: truth.urls.page}, {jobId: "account-b", videoVid: "account_video_b"});
    assert.deepEqual(accounts, ["account-a", "account-b"]);
  });

  await check("结果来源字段可持久化并在重启后恢复", async () => {
    const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-watermark-fields-"));
    const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
    const project = bridge.bootstrap().projects[0];
    const task = bridge.createTask({projectId: project.id, title: "无水印字段", prompt: "test", executionChannel: "doubao", accountId: "account-a", conversationId: truth.conversationId, videoVid: truth.videoVid, state: "downloading"});
    bridge.reportTask(task.id, {resultVid: truth.urls.main, resultUrls: [truth.urls.main], resultUrlSource: "doubao-aispace-watermark-free", watermarkFree: true, watermarkFreeError: "", resultSourceResolvedAt: "2026-08-20T00:00:00.000Z", fallbackResultVid: truth.urls.page});
    const restored = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot}).bootstrap().tasks.find(item => item.id === task.id);
    assert.equal(restored.resultUrlSource, "doubao-aispace-watermark-free");
    assert.equal(restored.watermarkFree, true);
    assert.equal(restored.fallbackResultVid, truth.urls.page);
  });

  await check("无水印恢复成功后可清空旧降级错误", async () => {
    const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-watermark-clear-error-"));
    const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
    const project = bridge.bootstrap().projects[0];
    const task = bridge.createTask({projectId: project.id, title: "清空旧错误", prompt: "test", executionChannel: "doubao", accountId: "account-a", conversationId: truth.conversationId, videoVid: truth.videoVid, state: "downloading", watermarkFreeError: "旧的降级错误"});
    const source = path.join(tenantRoot, "resolved.mp4");
    fs.writeFileSync(source, Buffer.from("resolved-video"));
    const asset = bridge.importAssets({projectId: project.id, paths: [source], source: "watermark-free-test"})[0];
    const completed = bridge.completeTask(task.id, {resultAssetId: asset.id, resultVid: truth.urls.main, videoVid: truth.videoVid, resultUrlSource: "doubao-aispace-watermark-free", watermarkFree: true, watermarkFreeError: "", evidence: {tenantId: path.basename(tenantRoot), accountId: "account-a", conversationId: truth.conversationId, submittedAt: new Date(Date.now() - 1000).toISOString()}});
    assert.equal(completed.watermarkFreeError, "");
    assert.equal(completed.watermarkFree, true);
  });

  await check("同一豆包 videoVid 不可绑定到两个任务", async () => {
    const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-watermark-video-vid-unique-"));
    const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
    const project = bridge.bootstrap().projects[0];
    const firstFile = path.join(tenantRoot, "first.mp4");
    const secondFile = path.join(tenantRoot, "second.mp4");
    fs.writeFileSync(firstFile, Buffer.from("first-video"));
    fs.writeFileSync(secondFile, Buffer.from("second-video"));
    const firstAsset = bridge.importAssets({projectId: project.id, paths: [firstFile], source: "watermark-free-test"})[0];
    const secondAsset = bridge.importAssets({projectId: project.id, paths: [secondFile], source: "watermark-free-test"})[0];
    const first = bridge.createTask({projectId: project.id, title: "VID 归属一", prompt: "first", executionChannel: "doubao", accountId: "account-a", conversationId: "conversation-one", state: "verifying"});
    const second = bridge.createTask({projectId: project.id, title: "VID 归属二", prompt: "second", executionChannel: "doubao", accountId: "account-a", conversationId: "conversation-two", state: "verifying"});
    const evidence = conversationId => ({tenantId: path.basename(tenantRoot), accountId: "account-a", conversationId, submittedAt: new Date(Date.now() - 1000).toISOString()});
    bridge.completeTask(first.id, {resultAssetId: firstAsset.id, resultVid: `${truth.urls.main}&signature=first`, videoVid: truth.videoVid, evidence: evidence("conversation-one")});
    assert.throws(() => bridge.completeTask(second.id, {resultAssetId: secondAsset.id, resultVid: `${truth.urls.main}&signature=second`, videoVid: truth.videoVid, evidence: evidence("conversation-two")}), /豆包视频 VID 已归属其他任务/);
  });

  await check("仅有 videoVid 时允许准备重新回传", async () => {
    const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-watermark-vid-recovery-"));
    const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
    const project = bridge.bootstrap().projects[0];
    const task = bridge.createTask({projectId: project.id, title: "VID 恢复", prompt: "test", executionChannel: "doubao", accountId: "account-a", conversationId: truth.conversationId, videoVid: truth.videoVid, state: "paused"});
    const prepared = bridge.prepareDoubaoResultRecovery(task.id, {videoVid: truth.videoVid, source: "test"});
    assert.equal(prepared.state, "downloading");
    assert.equal(prepared.videoVid, truth.videoVid);
    assert.deepEqual(prepared.resultUrls, []);
  });

  await check("安全重试子任务不继承旧 VID 和来源字段", async () => {
    const tenantRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-watermark-safe-retry-"));
    const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
    const project = bridge.bootstrap().projects[0];
    const original = bridge.createTask({projectId: project.id, title: "安全重试", prompt: "test", executionChannel: "doubao", accountId: "account-a", state: "failed", safeToRetry: true, notSentVerified: true, videoVid: truth.videoVid, resultUrlSource: "doubao-page-fallback", watermarkFree: false, watermarkFreeError: "failed", resultSourceResolvedAt: "2026-08-20T00:00:00.000Z", fallbackResultVid: truth.urls.page});
    const child = bridge.retryTask(original.id, {});
    assert.equal(child.videoVid, "");
    assert.equal(child.resultUrlSource, "");
    assert.equal(child.watermarkFree, null);
    assert.equal(child.watermarkFreeError, "");
    assert.equal(child.fallbackResultVid, "");
  });

  await check("任务中心展示来源且凭 videoVid 开放重新回传", async () => {
    const source = fs.readFileSync(path.join(root, "src", "renderer", "task-center.js"), "utf8");
    assert(source.includes("doubao-aispace-watermark-free"));
    assert(source.includes("doubao-page-fallback"));
    assert(source.includes("item?.videoVid||item?.resultVid"));
    assert(source.includes("豆包无水印源地址"));
  });

  await check("无水印和有水印地址在三个页面分别保留复制入口", async () => {
    const taskCenter = fs.readFileSync(path.join(root, "src", "renderer", "task-center.js"), "utf8");
    const home = fs.readFileSync(path.join(root, "src", "renderer", "home-conversations.js"), "utf8");
    const materials = fs.readFileSync(path.join(root, "src", "renderer", "project-materials.js"), "utf8");
    const orchestrator = fs.readFileSync(path.join(root, "src", "main", "generation-orchestrator.cjs"), "utf8");
    assert(taskCenter.includes("data-task-fallback-result-url"));
    assert(taskCenter.includes("豆包页面视频地址（有水印）"));
    assert(taskCenter.includes("复制有水印地址"));
    assert(home.includes("message.fallbackResultVid"));
    assert(home.includes("有水印视频地址"));
    assert(home.includes("hydrateTaskResults"));
    assert(home.includes("task.fallbackResultVid"));
    assert(materials.includes("复制有水印链接"));
    assert(orchestrator.includes("fallbackResultVid:value.fallbackResultVid"));
  });

  const report = {
    test: "doubao-watermark-free",
    testedAt: new Date().toISOString(),
    groundTruth: truthPath,
    total: results.length,
    passed: results.filter(item => item.ok).length,
    failed: results.filter(item => !item.ok).length,
    results,
  };
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed) process.exitCode = 1;
})().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
