"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {BrowserController} = require("../src/main/browser-controller.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "doubao-result-recovery-ground-truth.json"), "utf8"));
const source = file => fs.readFileSync(path.join(root, file), "utf8");
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.message || error)}); }
};

function validVideo(file) {
  fs.writeFileSync(file, Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypisom0000isommp41"), Buffer.alloc(65536)]));
  return file;
}

async function main() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-doubao-result-recovery-"));
  const tenant = "tenant-doubao-result";
  const tenantRoot = path.join(temp, "tenants", tenant);
  const tasks = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
  const project = tasks.bootstrap().projects[0];
  const actions = [];
  const resultFile = validVideo(path.join(temp, "recovered.mp4"));
  let failRecovery = false;
  let monitorDownloadFailure = false;
  const orchestrator = new GenerationOrchestrator({
    tenantIdProvider: () => tenant,
    tasks,
    modelGateway: {},
    dataRootProvider: () => tenantRoot,
    agentBridge: {browser: {execute: async command => {
      actions.push(command.action);
      if (command.action === "monitor" && monitorDownloadFailure) return {ok: true, state: "downloading", resultDownloadFailed: true, videoError: "豆包视频响应校验错误", videoUrl: "https://example.com/monitor-result.mp4", resultUrls: ["https://example.com/monitor-result.mp4"], submittedVerified: true};
      if (failRecovery) throw Object.assign(new Error("素材回传校验失败"), {code: "DOUBAO_RESULT_DOWNLOAD_FAILED"});
      return {ok: true, state: "completed", resultPath: resultFile, videoUrl: command.payload.resultUrl, resultUrls: [command.payload.resultUrl], conversationId: command.payload.conversationId};
    }}}
  });

  const task = tasks.createTask({projectId: project.id, title: "豆包回传恢复", prompt: "已经生成过的视频", executionChannel: "doubao", accountId: "account-1", accountName: "账号一", conversationId: "conversation-1", state: "paused"});
  tasks.reportTask(task.id, {state: "paused", stage: "manual_review", progress: 85, resultType: "video", resultUrls: ["https://example.com/doubao-result.mp4"], recoveryState: "result_review_required", submittedVerified: true});
  const recovered = await orchestrator.retryDoubaoResult(task.id);
  check("豆包仅重试结果回传可完成素材入库", () => { assert.equal(recovered.state, "completed"); assert(recovered.resultAssetId); });
  check("豆包回传重试不调用生成或监控入口", () => assert.deepEqual(actions, ["recover_result"]));

  const monitorTask = tasks.createTask({projectId: project.id, title: "自动回传校验错误", prompt: "已经提交的视频", executionChannel: "doubao", accountId: "account-monitor", accountName: "监控账号", conversationId: "conversation-monitor", state: "generating"});
  tasks.reportTask(monitorTask.id, {state: "generating", submittedVerified: true, evidence: {prompt: monitorTask.prompt, conversationId: monitorTask.conversationId, submittedAt: new Date().toISOString()}});
  orchestrator.holdAccount(monitorTask);monitorDownloadFailure = true;
  const monitorPaused = await orchestrator.runDoubao(monitorTask, "monitor");
  monitorDownloadFailure = false;
  check("自动监控发现素材回传错误后立即转人工处理", () => { assert.equal(monitorPaused.state, "paused"); assert.equal(monitorPaused.recoveryState, "result_review_required"); });
  check("素材回传错误后释放豆包账号队列", () => assert(!orchestrator.accountOwners.has(`doubao:${tenant}:account-monitor`)));

  const failedTask = tasks.createTask({projectId: project.id, title: "豆包回传失败", prompt: "不应重新发送", executionChannel: "doubao", accountId: "account-2", accountName: "账号二", conversationId: "conversation-2", state: "paused"});
  tasks.reportTask(failedTask.id, {state: "paused", resultType: "video", resultUrls: ["https://example.com/failed-result.mp4"], recoveryState: "result_review_required", submittedVerified: true});
  failRecovery = true;
  const failedRecovery = await orchestrator.retryDoubaoResult(failedTask.id);
  check("豆包回传失败进入人工处理状态", () => { assert.equal(failedRecovery.state, "paused"); assert.equal(failedRecovery.stage, "manual_review"); assert.equal(failedRecovery.recoveryState, "result_review_required"); });
  check("豆包回传失败保留原结果地址", () => assert.deepEqual(failedRecovery.resultUrls, ["https://example.com/failed-result.mp4"]));
  const cancelled = await orchestrator.cancel(failedTask.id);
  check("豆包回传人工处理状态可以本地取消", () => { assert.equal(cancelled.state, "cancelled"); assert.equal(cancelled.recoveryState, "local_result_recovery_cancelled"); });

  const legacyFailedTask = tasks.createTask({projectId: project.id, title: "历史回传失败", prompt: "历史任务提示词", executionChannel: "doubao", accountId: "account-3", accountName: "账号三", conversationId: "conversation-3", state: "paused"});
  tasks.reportTask(legacyFailedTask.id, {state: "paused", resultType: "video", resultUrls: ["https://example.com/legacy-result.mp4"], retryMode: "recover_result", recoveryState: "result_review_required", submittedVerified: true});
  tasks.reportTask(legacyFailedTask.id, {state: "failed", statusText: "旧版本素材回传失败"});
  failRecovery = false;
  const recoveredLegacy = await orchestrator.retryDoubaoResult(legacyFailedTask.id);
  check("旧版本已标记失败的回传任务也可仅恢复结果", () => assert.equal(recoveredLegacy.state, "completed"));

  const browser = new BrowserController({profileRootProvider: () => path.join(temp, "profiles"), downloadRootProvider: () => path.join(temp, "browser-downloads"), testMode: true});
  const browserResult = await browser.execute({action: "recover_result", account: {id: "account-fast", name: "Fast账号", platform: "豆包"}, payload: {jobId: "job-recover", resultUrl: "https://example.com/result.mp4", conversationId: "conversation-fast"}});
  check("浏览器恢复动作无需提示词即可下载已有结果", () => { assert.equal(browserResult.state, "completed"); assert(fs.existsSync(browserResult.resultPath)); });

  const parameterController = new BrowserController({profileRootProvider: () => path.join(temp, "parameter-profiles"), downloadRootProvider: () => path.join(temp, "parameter-downloads"), testMode: false});
  let composerTouched = false;
  parameterController.open = async () => ({testMode: false, phase: "idle", conversationId: ""});
  parameterController.connect = async () => ({});
  parameterController.detect = async () => ({loggedIn: true, verificationRequired: false});
  parameterController.evaluate = async () => ({verification: false});
  parameterController.prepareFreshConversation = async () => true;
  parameterController.ensureVideoMode = async () => { throw new Error("豆包当前页面没有找到模型：Seedance 2.0 Fast"); };
  parameterController.fillComposer = async () => { composerTouched = true; return true; };
  let parameterError = null;
  try { await parameterController.runGeneration({id: "fast-parameter", action: "generate", account: {id: "account-parameter", name: "参数账号"}, payload: {jobId: "fast-parameter", prompt: "参数失败前不应提交", doubaoModel: "Seedance 2.0 Fast", ratio: "16:9", duration: 5}}); }
  catch (error) { parameterError = error; }
  check("Fast 参数配置失败明确标记本次未提交", () => { assert(parameterError); assert.equal(parameterError.code, "DOUBAO_PARAMETER_CONFIG_FAILED"); assert.equal(parameterError.safeToRetry, true); assert.equal(parameterError.notSentVerified, true); assert.equal(parameterError.retryMode, "adjust_parameters"); assert.equal(composerTouched, false); });

  const parameterTask = tasks.createTask({projectId: project.id, title: "Fast 参数失败", prompt: "参数失败任务", executionChannel: "doubao", accountId: "account-parameter", accountName: "参数账号", doubaoModel: "Seedance 2.0 Fast", ratio: "16:9", duration: 5, state: "queued"});
  const parameterOrchestrator = new GenerationOrchestrator({tenantIdProvider: () => tenant, tasks, modelGateway: {}, dataRootProvider: () => tenantRoot, agentBridge: {browser: {execute: async () => { throw Object.assign(new Error("豆包当前页面没有找到模型：Seedance 2.0 Fast"), {code: "DOUBAO_PARAMETER_CONFIG_FAILED", category: "parameters", safeToRetry: true, notSentVerified: true, retryMode: "adjust_parameters", quotaConsumed: false}); }}}});
  try { await parameterOrchestrator.run(parameterTask.id); } catch {}
  const persistedParameterFailure = tasks.bootstrap().tasks.find(item => item.id === parameterTask.id);
  check("参数配置失败字段由编排器完整持久化", () => { assert.equal(persistedParameterFailure.state, "failed"); assert.equal(persistedParameterFailure.safeToRetry, true); assert.equal(persistedParameterFailure.notSentVerified, true); assert.equal(persistedParameterFailure.retryMode, "adjust_parameters"); assert.equal(persistedParameterFailure.failureCode, "DOUBAO_PARAMETER_CONFIG_FAILED"); });

  const legacyParameterTask = tasks.createTask({projectId: project.id, title: "历史 Fast 参数失败", prompt: "历史参数任务", executionChannel: "doubao", accountId: "account-legacy-fast", accountName: "历史账号", doubaoModel: "Seedance 2.0 Fast", state: "failed"});
  tasks.reportTask(legacyParameterTask.id, {state: "failed", error: "豆包当前页面没有找到模型：Seedance 2.0 Fast", safeToRetry: false, notSentVerified: false});
  const submittedParameterTask = tasks.createTask({projectId: project.id, title: "已有提交证据的 Fast 失败", prompt: "已有提交证据", executionChannel: "doubao", accountId: "account-submitted-fast", accountName: "已提交账号", doubaoModel: "Seedance 2.0 Fast", state: "failed"});
  tasks.reportTask(submittedParameterTask.id, {state: "failed", error: "豆包当前页面没有找到模型：Seedance 2.0 Fast", submittedVerified: true, evidence: {prompt: submittedParameterTask.prompt, conversationId: "conversation-submitted", submittedAt: new Date().toISOString()}, safeToRetry: false, notSentVerified: false});
  parameterOrchestrator.recoverInterruptedTasks();
  const upgradedLegacyParameterTask = tasks.bootstrap().tasks.find(item => item.id === legacyParameterTask.id);
  const protectedSubmittedParameterTask = tasks.bootstrap().tasks.find(item => item.id === submittedParameterTask.id);
  check("历史 Fast 参数失败且无提交证据时升级为安全重试", () => { assert.equal(upgradedLegacyParameterTask.safeToRetry, true); assert.equal(upgradedLegacyParameterTask.notSentVerified, true); assert.equal(upgradedLegacyParameterTask.retryMode, "adjust_parameters"); });
  check("已有提交证据的参数错误不会误标为未提交", () => { assert.equal(protectedSubmittedParameterTask.submittedVerified, true); assert.equal(protectedSubmittedParameterTask.safeToRetry, false); assert.equal(protectedSubmittedParameterTask.notSentVerified, false); });
  check("确认未提交的 Fast 参数失败允许保持原参数安全重试", () => { const child = tasks.retryTask(legacyParameterTask.id, {}); assert.equal(child.state, "queued"); assert.equal(child.doubaoModel, legacyParameterTask.doubaoModel); assert.equal(child.ratio, legacyParameterTask.ratio); assert.equal(child.duration, legacyParameterTask.duration); });
  const rejectedParameterTask = tasks.createTask({projectId: project.id, title: "豆包明确拒绝参数", prompt: "明确拒绝任务", executionChannel: "doubao", accountId: "account-rejected-parameter", accountName: "拒绝账号", doubaoModel: "Seedance 2.0 Mini", ratio: "16:9", duration: 15, state: "failed"});
  tasks.reportTask(rejectedParameterTask.id, {state: "failed", safeToRetry: true, notSentVerified: false, terminalFailureVerified: true, submittedVerified: true, retryMode: "adjust_parameters", failureCode: "DOUBAO_PARAMETER_REJECTED"});
  check("豆包已明确拒绝参数时仍要求修改后重试", () => assert.throws(() => tasks.retryTask(rejectedParameterTask.id, {}), /修改模型、比例或时长/));

  const controller = source("src/main/browser-controller.cjs");
  const manager = source("src/main/embedded-browser-manager.cjs");
  const orchestratorSource = source("src/main/generation-orchestrator.cjs");
  const mainSource = source("src/main/main.cjs");
  const preload = source("src/preload/preload.cjs");
  const center = source("src/renderer/task-center.js");
  const dock = source("src/renderer/generation-ui.js");
  check("Fast 模型通过真实 CDP 鼠标事件选择", () => truth.fastModel.requiredCdpEvents.forEach(eventName => assert(controller.includes(eventName), eventName)));
  check("Fast 模型选择后重新读取控制器确认", () => assert(controller.includes("豆包视频模型确认失败")));
  check("自动任务启动不显示豆包窗口", () => { const body = manager.slice(manager.indexOf("async beginTask"), manager.indexOf("updateTask(task")); assert(!body.includes("this.show(")); assert(manager.includes("backgroundThrottling: false")); });
  check("人工验证仍自动显示豆包窗口", () => assert(/task\.state === "awaiting_verification"[\s\S]*?this\.show\(item/.test(manager)));
  check("豆包回传恢复 IPC 已完整暴露", () => { assert(mainSource.includes("generation:doubao-retry-result")); assert(preload.includes("retryDoubaoResult")); });
  check("任务中心和实时任务坞提供豆包重新回传与取消", () => { for (const marker of ["data-doubao-result-retry", "data-doubao-result-cancel"]) { assert(center.includes(marker), marker); assert(dock.includes(marker), marker); } });
  check("任务中心区分参数安全重试和豆包参数拒绝", () => assert(center.includes("item.notSentVerified?'参数安全重试':'调整参数后重试'")));
  check("豆包恢复实现明确使用 recover_result", () => { assert(orchestratorSource.includes("retryDoubaoResult")); assert(orchestratorSource.includes('action:"recover_result"')); });

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-result-recovery", timestamp: new Date().toISOString(), truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, "doubao-result-recovery.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
