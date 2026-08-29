"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const root = path.resolve(__dirname, "..");
const browserSource = fs.readFileSync(path.join(root, "src/main/browser-controller.cjs"), "utf8");
const orchestratorSource = fs.readFileSync(path.join(root, "src/main/generation-orchestrator.cjs"), "utf8");
const {BrowserController, classifyDoubaoFailureMessage} = require(path.join(root, "src/main/browser-controller.cjs"));
const {GenerationOrchestrator} = require(path.join(root, "src/main/generation-orchestrator.cjs"));

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.message || error)}); }
}
async function checkAsync(name, fn) {
  try { await fn(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.message || error)}); }
}

(async () => {
  const controller = new BrowserController({
    profileRootProvider: () => fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-doubao-ops-")),
    downloadRootProvider: () => fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-doubao-download-")),
    testMode: true,
  });

  await checkAsync("不同账号初次提交可以并行、同账号仍串行", async () => {
    const events = [];
    const hold = (label, delay) => controller.withSubmissionLock(label, async () => {
      events.push(`${label}:start`);
      await new Promise(resolve => setTimeout(resolve, delay));
      events.push(`${label}:end`);
    });
    await Promise.all([hold("account-a", 35), hold("account-b", 10)]);
    assert(events.indexOf("account-b:end") < events.indexOf("account-a:end"), events.join(","));
    events.length = 0;
    await Promise.all([hold("account-a", 25), hold("account-a", 0)]);
    assert.deepEqual(events, ["account-a:start", "account-a:end", "account-a:start", "account-a:end"]);
  });

  check("submission_unknown 分支不得保留自动回退重提", () => {
    assert(!browserSource.includes("!retryCount && after?.userMessage && after?.explicitFallback"));
    assert(!browserSource.includes("retryCount = 1"));
  });

  await checkAsync("resume 异常时释放账号 lease", async () => {
    const task = {
      id: "resume-lease-task",
      state: "awaiting_verification",
      executionChannel: "doubao",
      accountId: "account-resume",
      accountName: "恢复账号",
      projectId: "project-1",
      prompt: "resume lease",
      doubaoModel: "Seedance 2.0 Mini",
      ratio: "自动",
      duration: "10s",
      assetIds: [],
      referenceAssets: [],
      evidence: {conversationId: "123456789", submittedAt: new Date().toISOString()},
    };
    const store = {
      bootstrap: () => ({tasks: [task], assets: []}),
      reportTask: (_id, patch) => { Object.assign(task, patch); return task; },
      resolveAsset: () => { throw new Error("no asset"); },
    };
    const orchestrator = new GenerationOrchestrator({
      tenantIdProvider: () => "tenant-resume",
      tasks: store,
      modelGateway: {},
      agentBridge: {browser: {execute: async () => ({
        ok: false,
        terminalFailureVerified: true,
        safeToRetry: true,
        notSentVerified: false,
        code: "DOUBAO_GENERATION_FAILED",
        category: "provider_generation",
        retryMode: "retry_or_edit",
        providerMessage: "明确失败",
      })}},
    });
    orchestrator.beginBrowserTask = async () => {};
    await orchestrator.resume(task.id);
    assert.equal(orchestrator.accountOwners.size, 0);
    assert.equal(orchestrator.accountLeases.size, 0);
  });

  await checkAsync("结果下载失败进入人工恢复并释放豆包账号", async () => {
    const task = {
      id: "download-recovery-task",
      state: "downloading",
      recoveryState: "result_download_failed",
      executionChannel: "doubao",
      accountId: "account-download",
      accountName: "下载恢复账号",
      conversationId: "conversation-download",
      projectId: "project-1",
      prompt: "download recovery",
      doubaoModel: "Seedance 2.0 Fast",
      ratio: "16:9",
      duration: "10s",
      assetIds: [],
      referenceAssets: [],
      resultUrls: ["https://example.invalid/result.mp4"],
      evidence: {conversationId: "conversation-download", submittedAt: new Date().toISOString()},
    };
    const actions = [];
    const store = {
      bootstrap: () => ({tasks: [task], assets: []}),
      reportTask: (_id, patch) => { Object.assign(task, patch); return task; },
    };
    const orchestrator = new GenerationOrchestrator({
      tenantIdProvider: () => "tenant-download",
      tasks: store,
      modelGateway: {},
      agentBridge: {browser: {execute: async command => {
        actions.push(command.action);
        return {ok: true, state: "downloading", resultDownloadFailed: true, code: "DOUBAO_RESULT_DOWNLOAD_FAILED", category: "result_download", retryMode: "recover_result", conversationId: "conversation-download", resultUrls: task.resultUrls, videoError: "temporary download failure"};
      }}},
    });
    orchestrator.beginBrowserTask = async () => {};
    orchestrator.scheduleMonitor = () => {};
    await orchestrator.monitor(task.id);
    assert.deepEqual(actions, ["monitor"]);
    assert.equal(task.state, "paused");
    assert.equal(task.recoveryState, "result_review_required");
    assert.equal(task.retryMode, "recover_result");
    assert.equal(task.conversationId, "conversation-download");
    assert.equal(task.accountAction, "release");
    assert.equal(orchestrator.accountOwners.has("doubao:tenant-download:account-download"), false);
    assert.equal(orchestrator.accountLeases.has(task.id), false);
  });

  check("结果下载失败具有独立豆包失败分类", () => {
    assert(browserSource.includes("DOUBAO_RESULT_DOWNLOAD_FAILED"));
    assert(orchestratorSource.includes("DOUBAO_RESULT_DOWNLOAD_FAILED"));
    assert(orchestratorSource.includes("recover_result"));
  });

  check("失败分类仍覆盖真实人脸、侵权素材、额度和登录", () => {
    const cases = [
      ["真实人脸", "DOUBAO_FACE_REFERENCE_REJECTED", "暂不支持上传真人脸素材"],
      ["素材侵权", "DOUBAO_COPYRIGHT_ASSET_REJECTED", "该参考素材可能涉及版权"],
      ["额度耗尽", "DOUBAO_VIDEO_QUOTA_EXHAUSTED", "今日视频生成免费次数用完了"],
      ["登录失效", "DOUBAO_LOGIN_REQUIRED", "登录状态已失效，请重新登录后再试"],
    ];
    for (const [name, code, message] of cases) assert.equal(classifyDoubaoFailureMessage(message).code, code, name);
  });

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-ops-invariants", timestamp: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, "doubao-ops-invariants.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
