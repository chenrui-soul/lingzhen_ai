"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "doubao-account-load-balancing-ground-truth.json");
const generatedTruth = {
  tenantId: "tenant-load-balancing-test",
  accounts: [
    {id: "account-a", name: "账号 A"},
    {id: "account-b", name: "账号 B"},
    {id: "account-c", name: "账号 C"}
  ],
  automaticTaskCount: 7,
  expectedAssignments: ["account-a", "account-b", "account-c", "account-a", "account-b", "account-c", "account-a"],
  humanLockedStates: ["awaiting_login", "awaiting_verification", "submission_unknown"],
  allLockedStatusText: "所有候选豆包账号都在等待人工处理，任务保持排队"
};
if (process.argv.includes("--refresh-ground-truth") || !fs.existsSync(truthPath)) {
  fs.mkdirSync(path.dirname(truthPath), {recursive: true});
  fs.writeFileSync(truthPath, JSON.stringify(generatedTruth, null, 2) + "\n", "utf8");
}
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const checks = [];
const check = async (name, operation) => {
  try { await operation(); checks.push({name, ok: true}); }
  catch (error) { checks.push({name, ok: false, error: String(error.stack || error)}); }
};

function makeStore(initialTasks = []) {
  const taskList = initialTasks.map(task => ({...task}));
  return {
    taskList,
    bootstrap: () => ({tasks: taskList}),
    reportTask: (taskId, patch) => {
      const task = taskList.find(item => item.id === taskId);
      if (!task) throw new Error(`测试任务不存在：${taskId}`);
      Object.assign(task, patch);
      return {...task};
    }
  };
}

function makeOrchestrator(store) {
  return new GenerationOrchestrator({
    tenantIdProvider: () => truth.tenantId,
    tasks: store,
    modelGateway: {},
    agentBridge: {browser: {}},
    dataRootProvider: () => root
  });
}

function autoTask(id, candidates = truth.accounts) {
  return {id, executionChannel: "doubao", state: "queued", accountSelectionMode: "auto", accountId: candidates[0]?.id || "", accountName: candidates[0]?.name || "", accountCandidates: candidates.map(item => ({...item}))};
}

(async () => {
  await check("自动调度按最小负载均匀分配", () => {
    const store = makeStore();
    const orchestrator = makeOrchestrator(store);
    const assignments = [];
    for (let index = 0; index < truth.automaticTaskCount; index += 1) {
      const task = autoTask(`auto-${index + 1}`);
      store.taskList.push(task);
      const selected = orchestrator.selectDoubaoAccount(task);
      assert(selected, `第 ${index + 1} 个任务没有选中账号`);
      assignments.push(selected.id);
      task.accountId = selected.id;
      task.accountName = selected.name;
      orchestrator.accountLeases.set(task.id, {key: orchestrator.accountKey(task), unlock: () => {}, tail: Promise.resolve()});
    }
    assert.deepStrictEqual(assignments, truth.expectedAssignments);
  });

  await check("三个自动任务会在三个账号上同时进入执行", async () => {
    const taskList = truth.accounts.map((account, index) => ({...autoTask(`parallel-${index + 1}`), title: `并行任务 ${index + 1}`, prompt: `并行提示词 ${index + 1}`, projectId: "project-test", creationType: "video", doubaoModel: "Seedance 2.0 Fast", ratio: "16:9", duration: "10s", assetIds: [], referenceAssets: []}));
    const store = makeStore(taskList);
    const calls = [];
    const orchestrator = new GenerationOrchestrator({tenantIdProvider: () => truth.tenantId, tasks: store, modelGateway: {}, agentBridge: {browser: {execute: async command => { calls.push(command.account.id); return {ok: true, generating: true, state: "generating", conversationId: `conversation-${command.account.id}`, submittedVerified: true, submittedEvidence: {prompt: command.payload.prompt, conversationId: `conversation-${command.account.id}`}, message: "正在生成"}; }}}, dataRootProvider: () => root});
    orchestrator.beginBrowserTask = async () => {};
    await Promise.all(taskList.map(task => orchestrator.run(task.id)));
    assert.deepStrictEqual(calls, truth.accounts.map(item => item.id));
    assert.equal(new Set(calls).size, truth.accounts.length);
    for (const task of taskList) { orchestrator.clearMonitor(task.id); orchestrator.releaseAccount(task.id); }
  });

  await check("等待人工处理的账号不会接收新的自动任务", () => {
    for (const state of truth.humanLockedStates) {
      const locked = {...truth.accounts[0]};
      const owner = {id: `owner-${state}`, executionChannel: "doubao", state, accountId: locked.id, accountName: locked.name, accountAction: "hold"};
      const task = autoTask(`waiting-${state}`);
      const store = makeStore([owner, task]);
      const orchestrator = makeOrchestrator(store);
      const key = orchestrator.accountKey(owner);
      orchestrator.accountOwners.set(key, owner.id);
      orchestrator.accountLeases.set(owner.id, {key, unlock: () => {}, tail: Promise.resolve()});
      const selected = orchestrator.selectDoubaoAccount(task);
      assert(selected, `${state} 场景没有选中其他账号`);
      assert.notEqual(selected.id, locked.id, `${state} 账号仍被分配新任务`);
      assert.equal(selected.id, truth.accounts[1].id);
    }
  });

  await check("全部账号等待人工处理时保持排队而不是误判额度耗尽", async () => {
    const owners = truth.accounts.map((account, index) => ({id: `locked-${index}`, executionChannel: "doubao", state: truth.humanLockedStates[index % truth.humanLockedStates.length], accountId: account.id, accountName: account.name, accountAction: "hold"}));
    const task = autoTask("all-locked");
    const store = makeStore([...owners, task]);
    const orchestrator = makeOrchestrator(store);
    for (const owner of owners) {
      const key = orchestrator.accountKey(owner);
      orchestrator.accountOwners.set(key, owner.id);
      orchestrator.accountLeases.set(owner.id, {key, unlock: () => {}, tail: Promise.resolve()});
    }
    assert.equal(orchestrator.selectDoubaoAccount(task), null);
    const waiting = await orchestrator.waitForAccountAvailability(task);
    assert.equal(waiting.state, "queued");
    assert.equal(waiting.statusText, truth.allLockedStatusText);
    orchestrator.clearAccountAvailabilityTimer(task.id);
  });

  await check("指定账号仍严格串行，不会被负载均衡改派", async () => {
    const first = {id: "manual-a-1", executionChannel: "doubao", state: "queued", accountSelectionMode: "manual", accountId: truth.accounts[0].id, accountName: truth.accounts[0].name, accountCandidates: [truth.accounts[0]]};
    const second = {...first, id: "manual-a-2"};
    const parallel = {...first, id: "manual-b-1", accountId: truth.accounts[1].id, accountName: truth.accounts[1].name, accountCandidates: [truth.accounts[1]]};
    const store = makeStore([first, second, parallel]);
    const orchestrator = makeOrchestrator(store);
    assert.equal(orchestrator.selectDoubaoAccount(second).id, truth.accounts[0].id);
    let secondResolved = false;
    await orchestrator.acquireAccount(first);
    const secondAcquire = orchestrator.acquireAccount(second).then(() => { secondResolved = true; });
    await orchestrator.acquireAccount(parallel);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(secondResolved, false, "同账号第二个任务不应提前获得执行权");
    assert.equal(orchestrator.accountOwners.get(orchestrator.accountKey(first)), first.id);
    assert.equal(orchestrator.accountOwners.get(orchestrator.accountKey(parallel)), parallel.id);
    orchestrator.releaseAccount(first.id);
    await secondAcquire;
    assert.equal(secondResolved, true);
    orchestrator.releaseAccount(second.id);
    orchestrator.releaseAccount(parallel.id);
  });

  const failed = checks.filter(item => !item.ok);
  const report = {test: "doubao-account-load-balancing", timestamp: new Date().toISOString(), groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  fs.mkdirSync(path.join(root, "scripts", "log"), {recursive: true});
  fs.writeFileSync(path.join(root, "scripts", "log", "doubao-account-load-balancing.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
