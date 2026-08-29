"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "home-task-center-e2e-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
fs.writeFileSync(truthPath, `${JSON.stringify(truth, null, 2)}\n`, "utf8");

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-home-task-center-e2e-"));
const tenantRoot = path.join(tempRoot, truth.tenantId);
const bridge = new WorkbenchDataBridge({tenantRootProvider: () => tenantRoot});
const project = bridge.bootstrap().projects[0];
const checks = [];
const liveStatuses = [];
const doubaoCommands = [];
const gatewayCalls = [];

function check(name, fn) {
  try {
    fn();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error.stack || error)});
  }
}

async function checkAsync(name, fn) {
  try {
    await fn();
    checks.push({name, ok: true});
  } catch (error) {
    checks.push({name, ok: false, error: String(error.stack || error)});
  }
}

async function waitFor(predicate, timeoutMs = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error("等待首页任务进入任务中心并完成超时");
}

const referencePath = path.join(tempRoot, "scene-reference.png");
const doubaoResultPath = path.join(tempRoot, "doubao-result.mp4");
fs.writeFileSync(referencePath, Buffer.from("home-reference-image"));
fs.writeFileSync(doubaoResultPath, Buffer.from("doubao-video-e2e"));
const referenceAsset = bridge.importAssets({projectId: project.id, paths: [referencePath], source: "test-fixture"})[0];

const agentBridge = {
  browser: {
    execute: async command => {
      doubaoCommands.push(JSON.parse(JSON.stringify(command)));
      assert.equal(command.action, "generate", "首页豆包 E2E 不应进入额外提交或恢复动作");
      return {
        ok: true,
        state: "completed",
        message: "豆包视频已生成",
        resultPath: doubaoResultPath,
        videoUrl: truth.doubao.videoUrl,
        conversationId: truth.doubao.conversationId,
        submittedVerified: true,
        submittedEvidence: {
          prompt: truth.doubao.prompt,
          conversationId: truth.doubao.conversationId,
          userMessageId: "message-home-e2e",
          requestId: "request-home-e2e",
          submittedAt: new Date().toISOString()
        }
      };
    }
  }
};

const modelGateway = {
  generate: async (providerId, modelId, input) => {
    gatewayCalls.push({providerId, modelId, input: JSON.parse(JSON.stringify(input))});
    return {
      ok: true,
      pending: false,
      type: "video",
      providerId,
      modelId,
      clientRequestId: input.clientRequestId,
      expectedResultCount: 1,
      urls: [truth.gateway.resultUrl]
    };
  }
};

const orchestrator = new GenerationOrchestrator({
  tenantIdProvider: () => truth.tenantId,
  tasks: bridge,
  modelGateway,
  agentBridge,
  dataRootProvider: () => tenantRoot,
  liveStatusProvider: status => liveStatuses.push(JSON.parse(JSON.stringify(status))),
  fetchImpl: async url => ({
    ok: String(url) === truth.gateway.resultUrl,
    status: String(url) === truth.gateway.resultUrl ? 200 : 404,
    arrayBuffer: async () => Buffer.from("gateway-video-e2e")
  })
});

(async () => {
  const doubaoCreated = await orchestrator.create({
    projectId: project.id,
    title: truth.doubao.title,
    prompt: truth.doubao.prompt,
    creationType: "video",
    creationSource: "home",
    executionChannel: "doubao",
    accountId: truth.doubao.accountId,
    accountName: truth.doubao.accountName,
    accountSelectionMode: "manual",
    accountCandidates: [{id: truth.doubao.accountId, name: truth.doubao.accountName, platform: "豆包"}],
    doubaoModel: truth.doubao.model,
    ratio: truth.doubao.ratio,
    duration: truth.doubao.duration,
    assetIds: [referenceAsset.id],
    referenceAssets: [{assetId: referenceAsset.id, ...truth.referenceAsset}]
  });

  const gatewayCreated = await orchestrator.create({
    projectId: project.id,
    title: truth.gateway.title,
    prompt: truth.gateway.prompt,
    creationType: "video",
    creationSource: "home",
    executionChannel: "model-gateway",
    providerId: truth.gateway.providerId,
    modelId: truth.gateway.modelId,
    ratio: truth.gateway.ratio,
    duration: truth.gateway.duration
  });

  await checkAsync("首页创建的豆包与模型网关任务都进入任务中心并完成", async () => {
    await waitFor(() => {
      const tasks = bridge.bootstrap().tasks;
      return tasks.find(item => item.id === doubaoCreated.id && item.state === "completed")
        && tasks.find(item => item.id === gatewayCreated.id && item.state === "completed");
    });
  });

  const snapshot = bridge.bootstrap();
  const doubaoTask = snapshot.tasks.find(item => item.id === doubaoCreated.id);
  const gatewayTask = snapshot.tasks.find(item => item.id === gatewayCreated.id);
  const doubaoResult = snapshot.assets.find(item => item.id === doubaoTask?.resultAssetId);
  const gatewayResult = snapshot.assets.find(item => item.id === gatewayTask?.resultAssetId);

  check("首页一次提交只创建一条任务记录", () => {
    assert.equal(snapshot.tasks.length, truth.expected.createdTasks);
    assert.equal(new Set(snapshot.tasks.map(item => item.id)).size, truth.expected.createdTasks);
  });
  check("首页豆包参数完整进入任务中心数据", () => {
    assert.equal(doubaoTask.creationSource, "home");
    assert.equal(doubaoTask.projectId, project.id);
    assert.equal(doubaoTask.prompt, truth.doubao.prompt);
    assert.equal(doubaoTask.doubaoModel, truth.doubao.model);
    assert.equal(doubaoTask.ratio, truth.doubao.ratio);
    assert.equal(doubaoTask.duration, truth.doubao.duration);
    assert.equal(doubaoTask.accountId, truth.doubao.accountId);
    assert.equal(doubaoTask.assetIds[0], referenceAsset.id);
    assert.deepStrictEqual(doubaoTask.referenceAssets[0], {assetId: referenceAsset.id, ...truth.referenceAsset});
  });
  check("豆包真实执行参数、参考图顺序和说明没有丢失", () => {
    assert.equal(doubaoCommands.length, truth.expected.doubaoGenerateCalls);
    const payload = doubaoCommands[0].payload;
    assert.equal(payload.prompt, truth.doubao.prompt);
    assert.equal(payload.doubaoModel, truth.doubao.model);
    assert.equal(payload.ratio, truth.doubao.ratio);
    assert.equal(payload.duration, truth.doubao.duration);
    assert.equal(payload.imageAssets.length, 1);
    assert.equal(payload.imageAssets[0].id, referenceAsset.id);
    assert.equal(payload.imageAssets[0].role, truth.referenceAsset.role);
    assert.equal(payload.imageAssets[0].description, truth.referenceAsset.description);
    assert.equal(payload.imageAssets[0].order, truth.referenceAsset.order);
  });
  check("模型网关参数与首页选择一致", () => {
    assert.equal(gatewayCalls.length, truth.expected.gatewayGenerateCalls);
    assert.equal(gatewayCalls[0].providerId, truth.gateway.providerId);
    assert.equal(gatewayCalls[0].modelId, truth.gateway.modelId);
    assert.equal(gatewayCalls[0].input.prompt, truth.gateway.prompt);
    assert.equal(gatewayCalls[0].input.parameters.aspect_ratio, truth.gateway.ratio);
    assert.equal(gatewayCalls[0].input.parameters.seconds, Number(truth.gateway.duration.replace("s", "")));
  });
  check("两个任务都只产生一个完成步骤", () => {
    for (const task of [doubaoTask, gatewayTask]) {
      assert.equal(task.state, "completed");
      assert.equal(task.progress, 100);
      assert.equal(task.steps.filter(step => step.state === "completed").length, 1);
    }
  });
  check("视频结果回填正确项目且素材来源可追溯", () => {
    assert(doubaoResult && gatewayResult);
    assert.equal(doubaoResult.projectId, project.id);
    assert.equal(gatewayResult.projectId, project.id);
    assert.equal(doubaoResult.source, "doubao-generation");
    assert.equal(gatewayResult.source, "model-gateway-generation");
    assert(doubaoResult.tags.includes("创作首页"));
    assert(gatewayResult.tags.includes("创作首页"));
    assert.equal(doubaoTask.resultVid, truth.doubao.videoUrl);
    assert.equal(gatewayTask.resultVid, truth.gateway.resultUrl);
  });
  check("任务中心读取到完整提示词、证据、执行方和结果", () => {
    for (const task of [doubaoTask, gatewayTask]) {
      assert(task.prompt);
      assert(task.evidence?.tenantId === truth.tenantId);
      assert(task.resultAssetId);
      assert(task.resultUrls.length === 1);
      assert(task.updatedAt);
    }
    assert.equal(doubaoTask.conversationId, truth.doubao.conversationId);
    assert.equal(gatewayTask.providerId, truth.gateway.providerId);
  });
  check("实时状态最终与任务中心完成状态一致", () => {
    const finalByTask = new Map();
    for (const status of liveStatuses) finalByTask.set(status.taskId, status);
    assert.equal(finalByTask.get(doubaoTask.id)?.state, "completed");
    assert.equal(finalByTask.get(gatewayTask.id)?.state, "completed");
    assert.equal(finalByTask.get(doubaoTask.id)?.resultAssetId, doubaoTask.resultAssetId);
    assert.equal(finalByTask.get(gatewayTask.id)?.resultAssetId, gatewayTask.resultAssetId);
  });
  check("首页与任务中心仍共用正式创建和查询接口", () => {
    const homeSource = fs.readFileSync(path.join(root, "src", "renderer", "app-fixes.js"), "utf8");
    const taskCenterSource = fs.readFileSync(path.join(root, "src", "renderer", "task-center.js"), "utf8");
    assert(homeSource.includes("api.generation.create(input)"));
    assert(homeSource.includes("creationSource:'home'"));
    assert(taskCenterSource.includes("api.workbench.bootstrap()"));
    assert(taskCenterSource.includes("tasks:data.tasks||[]"));
  });

  const failures = checks.filter(item => !item.ok);
  const report = {
    test: truth.test,
    timestamp: new Date().toISOString(),
    groundTruth: truthPath,
    tempRoot,
    total: checks.length,
    passed: checks.length - failures.length,
    failed: failures.length,
    checks
  };
  const logPath = path.join(root, "scripts", "log", "home-task-center-e2e.json");
  fs.mkdirSync(path.dirname(logPath), {recursive: true});
  fs.writeFileSync(logPath, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  orchestrator.dispose();
  if (failures.length) process.exitCode = 1;
})().catch(error => {
  orchestrator.dispose();
  console.error(error.stack || error);
  process.exitCode = 1;
});
