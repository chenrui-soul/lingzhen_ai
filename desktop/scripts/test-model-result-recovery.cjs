"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");
const {ModelGatewayBridge} = require("../src/main/model-gateway-bridge.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "model-result-recovery-ground-truth.json"), "utf8"));
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive: true});

function taskRecord(overrides = {}) {
  return {
    id: "task-result-recovery",
    projectId: "project-1",
    title: "结果恢复测试",
    prompt: "生成一张竖版图片",
    creationType: "image",
    executionChannel: "model-gateway",
    providerId: "provider-1",
    modelId: "gpt-image-2",
    ratio: "9:16",
    duration: "",
    resolution: "1080p",
    parameters: {},
    assetIds: [],
    state: "queued",
    statusText: "排队中",
    progress: 0,
    resultAssetId: "",
    resultVid: "",
    resultType: "",
    resultText: "",
    resultUrls: [],
    providerJobId: "",
    clientRequestId: "",
    recoveryState: "",
    evidence: null,
    steps: [],
    ...overrides
  };
}

function fakeTasks(initial) {
  let task = JSON.parse(JSON.stringify(initial));
  let assetIndex = 0;
  return {
    bootstrap: () => ({tasks: [JSON.parse(JSON.stringify(task))]}),
    reportTask: (_id, patch) => {
      task = {...task, ...JSON.parse(JSON.stringify(patch)), updatedAt: new Date().toISOString()};
      return JSON.parse(JSON.stringify(task));
    },
    importAssets: ({paths}) => {
      assert(fs.existsSync(paths[0]), "下载文件必须存在后才能导入素材中心");
      assetIndex += 1;
      return [{id: `asset-${assetIndex}`, projectId: task.projectId, type: task.resultType || "image", path: paths[0]}];
    },
    completeTask: (_id, input) => {
      task = {...task, ...JSON.parse(JSON.stringify(input)), state: "completed", progress: 100, statusText: "结果已校验并回填素材中心", error: null, recoveryState: "completed"};
      return JSON.parse(JSON.stringify(task));
    },
    current: () => JSON.parse(JSON.stringify(task))
  };
}

function gatewayWithCounter() {
  const state = {generateCalls: 0};
  return {
    state,
    generate: async () => {
      state.generateCalls += 1;
      return {ok: true, type: "image", providerId: "provider-1", modelId: "gpt-image-2", urls: ["https://result.invalid/generated.png"], providerJobId: "vendor-job-1"};
    }
  };
}

async function testTransientDownloadFailure() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-result-transient-"));
  const tasks = fakeTasks(taskRecord());
  const gateway = gatewayWithCounter();
  let downloads = 0;
  const orchestrator = new GenerationOrchestrator({
    tenantIdProvider: () => "tenant-1",
    tasks,
    modelGateway: gateway,
    agentBridge: {},
    dataRootProvider: () => temp,
    fetchImpl: async () => {
      downloads += 1;
      if (downloads === 1) throw new TypeError("fetch failed");
      return {ok: true, arrayBuffer: async () => Buffer.from("valid-image")};
    }
  });
  await orchestrator.runModel(tasks.current());
  const current = tasks.current();
  assert.equal(current.state, truth.cases.transient_download_failure.expectedState);
  assert.equal(gateway.state.generateCalls, truth.cases.transient_download_failure.expectedGenerateCalls);
  assert(downloads >= truth.cases.transient_download_failure.expectedMinimumDownloadCalls);
  assert.deepEqual(current.resultUrls, ["https://result.invalid/generated.png"]);
  orchestrator.dispose?.();
  return {state: current.state, generateCalls: gateway.state.generateCalls, downloads};
}

async function testPersistentFailureAndResume() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-result-resume-"));
  const tasks = fakeTasks(taskRecord());
  const gateway = gatewayWithCounter();
  let online = false;
  let downloads = 0;
  const orchestrator = new GenerationOrchestrator({
    tenantIdProvider: () => "tenant-1",
    tasks,
    modelGateway: gateway,
    agentBridge: {},
    dataRootProvider: () => temp,
    fetchImpl: async () => {
      downloads += 1;
      if (!online) throw new TypeError("fetch failed");
      return {ok: true, arrayBuffer: async () => Buffer.from("recovered-image")};
    }
  });
  await orchestrator.runModel(tasks.current());
  let current = tasks.current();
  assert.equal(current.state, truth.cases.persistent_download_failure.expectedState);
  assert.equal(current.recoveryState, truth.cases.persistent_download_failure.expectedRecoveryState);
  assert.equal(gateway.state.generateCalls, truth.cases.persistent_download_failure.expectedGenerateCalls);
  assert.deepEqual(current.resultUrls, ["https://result.invalid/generated.png"]);
  online = true;
  await orchestrator.recoverModelResult(current);
  current = tasks.current();
  assert.equal(current.state, truth.cases.resume_saved_result.expectedState);
  assert.equal(gateway.state.generateCalls, truth.cases.resume_saved_result.expectedGenerateCalls, "恢复回传不得重新调用生成接口");
  orchestrator.dispose?.();
  return {state: current.state, generateCalls: gateway.state.generateCalls, downloads};
}

async function testTransportFailureClassification() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-gateway-transport-"));
  const bridge = new ModelGatewayBridge({tenantRootProvider: () => temp, requestJson: async () => ({ok: false, error: "fetch failed", transportError: true})});
  const provider = bridge.createProvider({name: "测试", baseUrl: "https://example.invalid/v1", apiKey: "test"});
  bridge.addModel(provider.id, {id: "gpt-image-2", capabilities: {type: "image", confirmed: true}});
  let caught = null;
  try { await bridge.generate(provider.id, "gpt-image-2", {prompt: "test"}); } catch (error) { caught = error; }
  assert(caught, "网络异常必须抛出可分类错误");
  assert.equal(caught.submissionUnknown, truth.cases.transport_failure_after_post.expectedSubmissionUnknown);
  assert.equal(caught.safeToRetry, truth.cases.transport_failure_after_post.expectedSafeToRetry);
  assert(caught.clientRequestId, "网络异常也必须保留客户端请求标识");
  return {submissionUnknown: caught.submissionUnknown, safeToRetry: caught.safeToRetry, clientRequestId: Boolean(caught.clientRequestId)};
}

async function testCaiCaiAsyncImageContract() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-gateway-async-image-"));
  const calls = [];
  const bridge = new ModelGatewayBridge({tenantRootProvider: () => temp, requestJson: async (_provider, requestPath, options) => {
    calls.push({requestPath, options});
    if (options.method === "POST") return {ok: true, body: {id: "task-image-1", object: "image_task", status: "processing"}};
    return {ok: true, body: {id: "task-image-1", object: "image_task", status: "completed", image_urls: ["https://result.invalid/async.png"]}};
  }});
  const provider = bridge.createProvider({name: "词元", baseUrl: "https://caicaiapi.cloud/v1", apiKey: "test",
    imageTasksPath: "/v1/images/tasks", imageStatusPath: "/v1/images/tasks/{id}"});
  bridge.addModel(provider.id, {id: "gpt-image-2", capabilities: {type: "image", confirmed: true}});
  const created = await bridge.generate(provider.id, "gpt-image-2", {prompt: "test", clientRequestId: "client-image-1"});
  assert.equal(calls[0].requestPath, "/v1/images/tasks");
  assert.equal(calls[0].options.headers["Idempotency-Key"], "client-image-1");
  assert.equal(calls[0].options.headers["X-Request-ID"], "client-image-1");
  assert.equal(created.pending, true);
  assert.equal(created.providerJobId, "task-image-1");
  const completed = await bridge.queryGeneration(provider.id, "gpt-image-2", {providerJobId: created.providerJobId, clientRequestId: created.clientRequestId, type: "image"});
  assert.equal(calls[1].requestPath, "/v1/images/tasks/task-image-1");
  assert.equal(completed.completed, true);
  assert.deepEqual(completed.urls, ["https://result.invalid/async.png"]);
  return {submitPath: calls[0].requestPath, queryPath: calls[1].requestPath, status: completed.status};
}

async function testGatewayQueryOutcomes() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-gateway-query-outcomes-"));
  let response = {ok: true, body: {id: "task-1", status: "processing"}};
  const bridge = new ModelGatewayBridge({tenantRootProvider: () => temp, requestJson: async () => response});
  const provider = bridge.createProvider({name: "查询测试", baseUrl: "https://api.example.invalid/v1", imageStatusPath: "/v1/images/tasks/{id}"});
  bridge.addModel(provider.id, {id: "gpt-image-2", capabilities: {type: "image", confirmed: true}});
  const pending = await bridge.queryGeneration(provider.id, "gpt-image-2", {providerJobId: "task-1", type: "image"});
  assert.equal(pending.pending, true);
  response = {ok: true, body: {id: "task-1", status: "failed", error: {code: "generation_failed", message: "上游服务超时"}}};
  const failed = await bridge.queryGeneration(provider.id, "gpt-image-2", {providerJobId: "task-1", type: "image"});
  assert.equal(failed.failed, true);
  assert.equal(failed.error, "上游服务超时");
  response = {ok: false, status: 404, body: {error: {code: "task_not_found", message: "任务不存在"}}, error: "任务不存在", transportError: false};
  const notFound = await bridge.queryGeneration(provider.id, "gpt-image-2", {providerJobId: "task-1", type: "image"});
  assert.equal(notFound.notFound, true);
  assert.equal(notFound.notSentVerified, false, "已有厂商任务 ID 时，404 不能证明请求未发送");
  const requestProvider = bridge.createProvider({name: "请求标识查询", baseUrl: "https://request.example.invalid/v1", requestStatusPath: "/v1/requests/{requestId}"});
  bridge.addModel(requestProvider.id, {id: "gpt-image-2", capabilities: {type: "image", confirmed: true}});
  const verifiedNotSent = await bridge.queryGeneration(requestProvider.id, "gpt-image-2", {clientRequestId: "client-not-created", type: "image"});
  assert.equal(verifiedNotSent.notFound, true);
  assert.equal(verifiedNotSent.notSentVerified, true, "只有按客户端请求标识明确查询不到时才证明未创建");
  const generic = bridge.createProvider({name: "无查询接口", baseUrl: "https://generic.example.invalid/v1"});
  bridge.addModel(generic.id, {id: "gpt-image-2", capabilities: {type: "image", confirmed: true}});
  const unsupported = await bridge.queryGeneration(generic.id, "gpt-image-2", {clientRequestId: "client-only", type: "image"});
  assert.equal(unsupported.supported, false);
  response = {ok: false, error: "fetch failed", transportError: true};
  await assert.rejects(() => bridge.queryGeneration(provider.id, "gpt-image-2", {providerJobId: "task-1", type: "image"}), error => error.transportError === true);
  return {pending: pending.status, failed: failed.status, notFound: notFound.status, verifiedNotSent: verifiedNotSent.notSentVerified, unsupported: unsupported.status, transportError: true};
}

async function testSubmissionUnknownSafetyAndRecovery() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-submission-unknown-recovery-"));
  const noIdentifierTasks = fakeTasks(taskRecord({state: "submission_unknown", error: "请求超时"}));
  let queryCalls = 0;
  let generateCalls = 0;
  const idleGateway = {generate: async () => { generateCalls += 1; }, queryGeneration: async () => { queryCalls += 1; return {supported: false}; }};
  const idleOrchestrator = new GenerationOrchestrator({tenantIdProvider: () => "tenant-1", tasks: noIdentifierTasks, modelGateway: idleGateway, agentBridge: {}, dataRootProvider: () => temp});
  idleOrchestrator.recoverInterruptedTasks();
  await new Promise(resolve => setTimeout(resolve, 30));
  await idleOrchestrator.recoverModelResult(noIdentifierTasks.current());
  assert.equal(generateCalls, 0, "没有任何查询标识时不得重新调用生成接口");
  assert.equal(queryCalls, 0, "没有任何查询标识时不应发起无意义查询");
  idleOrchestrator.dispose();

  const protectedTasks = fakeTasks(taskRecord({state: "submission_unknown", clientRequestId: "client-only", error: "请求超时"}));
  const unsupportedGateway = {generate: async () => { generateCalls += 1; }, queryGeneration: async () => ({supported: false, error: "当前厂商未配置可用的任务查询接口"})};
  const protectedOrchestrator = new GenerationOrchestrator({tenantIdProvider: () => "tenant-1", tasks: protectedTasks, modelGateway: unsupportedGateway, agentBridge: {}, dataRootProvider: () => temp});
  await protectedOrchestrator.recoverModelResult(protectedTasks.current());
  assert.equal(protectedTasks.current().state, "submission_unknown");
  assert.equal(protectedTasks.current().recoveryState, "query_unsupported");
  assert.equal(generateCalls, 0, "查询不支持时不得重新调用生成接口");
  protectedOrchestrator.dispose();

  const recoverableTasks = fakeTasks(taskRecord({state: "submission_unknown", providerJobId: "task-image-1", clientRequestId: "client-image-1", resultType: "image", evidence: {tenantId: "tenant-1", providerId: "provider-1", modelId: "gpt-image-2", clientRequestId: "client-image-1", providerJobId: "task-image-1", submittedAt: new Date().toISOString()}}));
  const recoveryGateway = {generate: async () => { generateCalls += 1; }, queryGeneration: async () => ({supported: true, completed: true, pending: false, failed: false, notFound: false, status: "completed", urls: ["https://result.invalid/recovered.png"], providerJobId: "task-image-1"})};
  const recoveryOrchestrator = new GenerationOrchestrator({tenantIdProvider: () => "tenant-1", tasks: recoverableTasks, modelGateway: recoveryGateway, agentBridge: {}, dataRootProvider: () => temp, fetchImpl: async () => ({ok: true, arrayBuffer: async () => Buffer.from("recovered-image")})});
  await recoveryOrchestrator.recoverModelResult(recoverableTasks.current());
  assert.equal(recoverableTasks.current().state, "completed");
  assert.equal(generateCalls, 0, "恢复成功只能查询和下载，不能重新生成");
  recoveryOrchestrator.dispose();
  return {noIdentifierState: noIdentifierTasks.current().state, protectedState: protectedTasks.current().state, recoveredState: recoverableTasks.current().state, generateCalls, queryCalls};
}

async function testProviderFailureBecomesRetryableTerminal() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-provider-failed-"));
  const tasks = fakeTasks(taskRecord({state: "generating", providerJobId: "task-failed", clientRequestId: "client-failed", resultType: "image"}));
  const gateway = {queryGeneration: async () => ({supported: true, completed: false, pending: false, failed: true, notFound: false, status: "failed", urls: [], providerJobId: "task-failed", error: "内容审核未通过"})};
  const orchestrator = new GenerationOrchestrator({tenantIdProvider: () => "tenant-1", tasks, modelGateway: gateway, agentBridge: {}, dataRootProvider: () => temp});
  await orchestrator.recoverModelResult(tasks.current());
  const current = tasks.current();
  assert.equal(current.state, "failed");
  assert.equal(current.safeToRetry, true);
  assert.equal(current.terminalFailureVerified, true);
  assert.equal(current.failureCode, "MODEL_PROVIDER_GENERATION_FAILED");
  orchestrator.dispose();
  return {state: current.state, safeToRetry: current.safeToRetry, terminalFailureVerified: current.terminalFailureVerified};
}

async function testVisualParameterMapping() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-gateway-params-"));
  let requestBody = null;
  const bridge = new ModelGatewayBridge({tenantRootProvider: () => temp, requestJson: async (_provider, _path, options) => { requestBody = options.body; return {ok: true, body: {data: [{url: "https://result.invalid/image.png"}]}}; }});
  const provider = bridge.createProvider({name: "测试", baseUrl: "https://example.invalid/v1", apiKey: "test"});
  bridge.addModel(provider.id, {id: "gpt-image-2", capabilities: {type: "image", confirmed: true}});
  await bridge.generate(provider.id, "gpt-image-2", {prompt: "test", parameters: {ratio: "9:16", resolution: "1080p"}});
  assert.equal(requestBody.aspect_ratio, truth.cases.visual_parameter_mapping.expectedAspectRatio);
  assert(!Object.prototype.hasOwnProperty.call(requestBody, "ratio"), "不得继续发送错误的 ratio 字段");
  return {aspect_ratio: requestBody.aspect_ratio, hasRatio: Object.prototype.hasOwnProperty.call(requestBody, "ratio")};
}

async function testRecoveryFieldsPersistence() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-result-fields-"));
  const bridge = new WorkbenchDataBridge({tenantRootProvider: () => temp});
  const project = bridge.createProject({name: "恢复测试项目"});
  const task = bridge.createTask({projectId: project.id, title: "恢复字段", prompt: "test", creationType: "image", executionChannel: "model-gateway", providerId: "provider-1", modelId: "gpt-image-2", state: "queued"});
  bridge.reportTask(task.id, {state: "downloading", progress: 85, resultType: "image", resultUrls: ["https://result.invalid/image.png"], providerJobId: "vendor-job-1", clientRequestId: "client-request-1", recoveryState: "retrying", error: "fetch failed"});
  const restored = bridge.bootstrap().tasks.find(item => item.id === task.id);
  assert.equal(restored.state, "downloading");
  assert.equal(restored.resultType, "image");
  assert.deepEqual(restored.resultUrls, ["https://result.invalid/image.png"]);
  assert.equal(restored.providerJobId, "vendor-job-1");
  assert.equal(restored.clientRequestId, "client-request-1");
  assert.equal(restored.recoveryState, "retrying");
  return {state: restored.state, resultUrls: restored.resultUrls.length, providerJobId: restored.providerJobId, clientRequestId: restored.clientRequestId, recoveryState: restored.recoveryState};
}

(async () => {
  const cases = {};
  const failures = [];
  for (const [name, fn] of Object.entries({transient_download_failure: testTransientDownloadFailure, persistent_failure_and_resume: testPersistentFailureAndResume, transport_failure_classification: testTransportFailureClassification, caicai_async_image_contract: testCaiCaiAsyncImageContract, gateway_query_outcomes: testGatewayQueryOutcomes, submission_unknown_safety_and_recovery: testSubmissionUnknownSafetyAndRecovery, provider_failure_retryable_terminal: testProviderFailureBecomesRetryableTerminal, visual_parameter_mapping: testVisualParameterMapping, recovery_fields_persistence: testRecoveryFieldsPersistence})) {
    try { cases[name] = {ok: true, detail: await fn()}; }
    catch (error) { cases[name] = {ok: false, error: error.stack || String(error)}; failures.push(name); }
  }
  const report = {test: "model-result-recovery", timestamp: new Date().toISOString(), passed: Object.keys(cases).length - failures.length, total: Object.keys(cases).length, failures, cases};
  fs.writeFileSync(path.join(logDir, "model-result-recovery.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exitCode = 1;
})();
