"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const {GenerationOrchestrator} = require(path.join(__dirname, "..", "src", "main", "generation-orchestrator.cjs"));

async function main() {
  const root = path.join(__dirname, "..");
  const controllerSource = fs.readFileSync(path.join(root, "src", "main", "browser-controller.cjs"), "utf8");
  const task = {id:"unknown-recover",title:"延迟提交证据",prompt:"雪地视频",state:"submission_unknown",executionChannel:"doubao",accountId:"desktop-1",accountName:"白同学",conversationId:"",evidence:null};
  const actions = [];
  const tasks = {
    bootstrap: () => ({tasks:[task]}),
    reportTask: (_id, patch) => Object.assign(task, patch)
  };
  const orchestrator = new GenerationOrchestrator({
    tenantIdProvider: () => "tenant-unknown-recovery",
    tasks,
    modelGateway: {},
    agentBridge: {
      browser: {
        embeddedBrowserProvider: () => ({beginTask: async () => {}}),
        execute: async command => { actions.push(command.action); return {ok:true,submissionRecovered:true,conversationId:"38437964824224258",submittedEvidence:{prompt:"雪地视频",conversationId:"38437964824224258",evidenceType:"terminal-audit-current-conversation"}}; }
      }
    },
    dataRootProvider: () => root
  });
  const recovered = await orchestrator.auditSubmissionUnknown(task);
  assert.strictEqual(task.state, "generating");
  assert.strictEqual(task.conversationId, "38437964824224258");
  assert.strictEqual(task.submittedVerified, true);
  assert.deepStrictEqual(actions, ["monitor"], "恢复只能观察原会话，不得重新提交");
  assert.strictEqual(orchestrator.accountOwners.get("doubao:tenant-unknown-recovery:desktop-1"), task.id, "恢复期间继续锁定原账号");
  assert.strictEqual(recovered.state, "generating");
  orchestrator.dispose();
  assert(controllerSource.includes("submissionRecovered"), "控制器应支持从原会话审计恢复提交证据");
  assert(controllerSource.includes("terminal-audit-current-conversation"), "恢复证据必须标注为原会话审计");
  console.log(JSON.stringify({
    test: "doubao-submission-unknown-recovery",
    total: 6,
    passed: 6,
    failed: 0,
    checks: [
      "submission_unknown 仅调用 monitor",
      "原 conversation 证据出现后恢复 generating",
      "submittedVerified 正确写回",
      "恢复期间保持原账号锁",
      "不重新发送提示词",
      "控制器保留原会话审计证据类型"
    ]
  }, null, 2));
}

main().catch(error => {
  console.error(error.stack || error);
  process.exit(1);
});
