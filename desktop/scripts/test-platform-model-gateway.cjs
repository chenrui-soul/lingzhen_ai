"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {PlatformModelGatewayBridge, RoutedModelGatewayBridge} = require("../src/main/platform-model-gateway-bridge.cjs");

const truth = JSON.parse(fs.readFileSync(path.join(__dirname, "../references/platform-model-gateway-ground-truth.json"), "utf8"));
const calls = [];
let response = {};
const authClient = {
  status: () => ({bootstrap: {data: {models: [
    {id: truth.platformModelId, source: "platform", provider: {id: truth.platformProviderId, displayName: "灵帧平台"}, displayName: "平台文本", capabilityType: "text", executionReady: true, parameterSchema: {}, defaultParameters: {}},
    {id: "disabled-model", source: "platform", provider: {id: truth.platformProviderId, displayName: "灵帧平台"}, displayName: "未配置模型", capabilityType: "text", executionReady: false, parameterSchema: {}, defaultParameters: {}},
  ]}}}),
  authenticatedRequest: async (pathname, options) => { calls.push({pathname, options}); return response; },
};
let localGenerateCalls = 0;
const localGateway = {
  bootstrap: () => [{id: truth.localProviderId, name: "本地模型", models: [{id: truth.localModelId, displayName: "本地文本", enabled: true}]}],
  generate: async (providerId, modelId) => { localGenerateCalls += 1; return {ok: true, type: "text", providerId, modelId, content: "本地结果", urls: [], pending: false}; },
  queryGeneration: async () => ({supported: true, completed: true}),
  cancelGeneration: async () => ({supported: true, cancelled: true}),
};
const platformGateway = new PlatformModelGatewayBridge({authClient});
const routed = new RoutedModelGatewayBridge({localGateway, platformGateway});
const results = [];
const check = async (name, operation) => {
  try { await operation(); results.push({name, ok: true}); }
  catch (error) { results.push({name, ok: false, error: String(error.stack || error)}); }
};

(async () => {
  await check("execution catalog exposes only executable platform models", async () => {
    const catalog = routed.executionCatalog();
    const platform = catalog.find(item => item.id === truth.platformProviderId);
    assert(platform);
    assert.deepStrictEqual(platform.models.map(item => item.id), [truth.platformModelId]);
    assert(catalog.some(item => item.id === truth.localProviderId));
  });

  await check("published catalog keeps non executable platform models visible", async () => {
    const catalog = routed.catalog();
    const platform = catalog.find(item => item.id === truth.platformProviderId);
    assert(platform);
    assert.deepStrictEqual(platform.models.map(item => item.id), [truth.platformModelId, "disabled-model"]);
    const unavailable = platform.models.find(item => item.id === "disabled-model");
    assert.equal(unavailable.executionReady, false);
    assert.equal(unavailable.enabled, false);
  });

  await check("platform submission uses authenticated backend proxy", async () => {
    response = {taskId: truth.platformTaskId, state: "pending", resultUrls: [], resultText: ""};
    const result = await routed.generate(truth.platformProviderId, truth.platformModelId, {prompt: "测试平台文本", clientRequestId: "client-1"});
    assert.equal(result.pending, true);
    assert.equal(result.providerJobId, truth.platformTaskId);
    assert.equal(localGenerateCalls, 0);
    assert.equal(calls.at(-1).pathname, "/api/v1/desktop/platform-model-tasks");
    assert.equal(calls.at(-1).options.body.modelId, truth.platformModelId);
  });

  await check("platform query returns asynchronous text content", async () => {
    response = {taskId: truth.platformTaskId, state: "completed", resultUrls: [], resultText: truth.resultText};
    const result = await routed.queryGeneration(truth.platformProviderId, truth.platformModelId, {providerJobId: truth.platformTaskId, type: "text"});
    assert.equal(result.completed, true);
    assert.equal(result.content, truth.resultText);
    assert.equal(result.type, "text");
    assert.match(calls.at(-1).pathname, new RegExp(`${truth.platformTaskId}$`));
  });

  await check("local BYOK models remain on the local gateway", async () => {
    const before = calls.length;
    const result = await routed.generate(truth.localProviderId, truth.localModelId, {prompt: "本地测试"});
    assert.equal(result.content, "本地结果");
    assert.equal(localGenerateCalls, 1);
    assert.equal(calls.length, before);
  });

  await check("local reference files are rejected before platform submission", async () => {
    const before = calls.length;
    await assert.rejects(() => routed.generate(truth.platformProviderId, truth.platformModelId, {prompt: "图片参考", assets: [{id: "asset-1", path: "C:/local/person.png"}]}), error => error.code === "PLATFORM_REFERENCE_NOT_UPLOADED");
    assert.equal(calls.length, before);
  });

  const failed = results.filter(item => !item.ok);
  const report = {test: "platform-model-gateway", total: results.length, passed: results.length - failed.length, failed: failed.length, results};
  fs.mkdirSync(path.join(__dirname, "log"), {recursive: true});
  fs.writeFileSync(path.join(__dirname, "log/platform-model-gateway.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(`PLATFORM_MODEL_GATEWAY_TESTS ${report.passed}/${report.total}`);
  if (failed.length) {
    for (const item of failed) console.error(item.name, item.error);
    process.exit(1);
  }
})();
