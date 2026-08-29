"use strict";

const assert = require("assert");
const path = require("path");
const {GenerationOrchestrator} = require(path.join(__dirname, "..", "src", "main", "generation-orchestrator.cjs"));

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function taskStore(tasks) {
  return {
    bootstrap: () => ({tasks}),
    reportTask: (taskId, patch) => Object.assign(tasks.find(item => item.id === taskId), patch)
  };
}

function orchestrator(tasks) {
  return new GenerationOrchestrator({
    tenantIdProvider: () => "tenant-startup-recovery",
    tasks: taskStore(tasks),
    modelGateway: {},
    agentBridge: {},
    dataRootProvider: () => path.join(__dirname, "..")
  });
}

async function main() {
  const cleanQueued = {id:"queued-clean",title:"普通排队任务",executionChannel:"doubao",state:"queued",accountId:"desktop-1",accountName:"白同学",conversationId:"",submittedVerified:false,evidence:null};
  const cleanRuntime = orchestrator([cleanQueued]);
  const cleanRuns = [];
  cleanRuntime.run = async taskId => cleanRuns.push(taskId);
  cleanRuntime.recoverInterruptedTasks();
  await wait(20);
  assert.deepStrictEqual(cleanRuns, [cleanQueued.id], "无提交证据的排队任务应在客户端重启后恢复调度");
  assert.strictEqual(cleanQueued.state, "queued", "任务标题或旧排队文案不得被误判为人工验证");

  const protectedQueued = {id:"queued-protected",title:"包含验证字样的普通标题",executionChannel:"doubao",state:"queued",accountId:"desktop-1",accountName:"白同学",conversationId:"conversation-1",submittedVerified:true,evidence:{prompt:"已提交提示词",conversationId:"conversation-1",submittedAt:new Date().toISOString()}};
  const protectedRuntime = orchestrator([protectedQueued]);
  const protectedRuns = [];
  protectedRuntime.run = async taskId => protectedRuns.push(taskId);
  protectedRuntime.recoverInterruptedTasks();
  await wait(20);
  assert.deepStrictEqual(protectedRuns, [], "包含提交证据的排队记录不得自动重提");
  assert.strictEqual(protectedQueued.state, "submission_unknown", "已有提交证据但状态矛盾时必须进入提交未知保护");
  assert.strictEqual(protectedQueued.notSentVerified, false);
  assert.strictEqual(protectedRuntime.accountOwners.get("doubao:tenant-startup-recovery:desktop-1"), protectedQueued.id, "提交未知必须锁定原账号");
  protectedRuntime.dispose();

  const verificationTask = {id:"verify-real",title:"普通任务",executionChannel:"doubao",state:"awaiting_verification",accountId:"desktop-2",accountName:"账号二",conversationId:"conversation-2"};
  const verificationRuntime = orchestrator([verificationTask]);
  const verificationRuns = [];
  verificationRuntime.run = async taskId => verificationRuns.push(taskId);
  verificationRuntime.recoverInterruptedTasks();
  await wait(20);
  assert.deepStrictEqual(verificationRuns, [], "真正的人工验证任务只能由人工完成后继续");

  console.log(JSON.stringify({
    test: "doubao-startup-queue-recovery",
    passed: 7,
    failed: 0,
    checks: [
      "无提交证据 queued 重启后恢复调度",
      "标题不参与验证状态判断",
      "已有提交证据 queued 不自动重提",
      "矛盾状态进入 submission_unknown",
      "submission_unknown 保持 notSentVerified=false",
      "submission_unknown 锁定原账号",
      "awaiting_verification 不自动继续"
    ]
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
