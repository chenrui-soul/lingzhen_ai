"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");

const root = path.resolve(__dirname, "..");
const truthPath = path.join(root, "references", "doubao-failure-persistence-ground-truth.json");
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-failure-persistence-"));
const tenantRoot = path.join(tempRoot, truth.tenantId);
const checks = [];
const check = (name, fn) => {
  try { fn(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, error:String(error.stack || error)}); }
};

const first = new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const project = first.bootstrap().projects[0];
const created = first.createTask({
  projectId:project.id,
  title:truth.task.title,
  prompt:truth.task.prompt,
  creationType:"video",
  creationSource:"persistence-test",
  executionChannel:"doubao",
  accountId:truth.task.accountId,
  accountName:truth.task.accountName,
  conversationId:truth.task.conversationId,
  state:"generating",
  progressMode:"indeterminate",
  monitorError:"旧监控错误",
  monitorProbe:{attempt:3}
});
const reported = first.reportTask(created.id, truth.failure);
const reloadedBridge = new WorkbenchDataBridge({tenantRootProvider:()=>tenantRoot});
const reloaded = reloadedBridge.bootstrap().tasks.find(item=>item.id===created.id);

check("失败状态已写入", ()=>assert.equal(reported.state, truth.failure.state));
check("终止结果代码持久化", ()=>assert.equal(reloaded.outcomeCode, truth.failure.outcomeCode));
check("提交与终止证据持久化", ()=>{assert.equal(reloaded.submittedVerified, true);assert.equal(reloaded.terminalFailureVerified, true);});
check("账号释放动作持久化", ()=>assert.equal(reloaded.accountAction, "release"));
check("重试策略持久化", ()=>{assert.equal(reloaded.retryMode, truth.failure.retryMode);assert.equal(reloaded.safeToRetry, true);assert.equal(reloaded.notSentVerified, false);});
check("失败分类与用户指引持久化", ()=>{assert.equal(reloaded.failureCode, truth.failure.failureCode);assert.equal(reloaded.failureCategory, truth.failure.failureCategory);assert.equal(reloaded.providerMessage, truth.failure.providerMessage);assert.equal(reloaded.userAction, truth.failure.userAction);});
check("失败证据对象持久化", ()=>assert.deepStrictEqual(reloaded.failureEvidence, truth.failure.failureEvidence));
check("终止失败清除旧监控残留", ()=>{assert.equal(reloaded.monitorError, "");assert.equal(reloaded.monitorProbe, null);});
check("失败状态不再显示不确定进度", ()=>assert.equal(reloaded.progressMode, "determinate"));
check("公开任务字段完整", ()=>{for(const key of ["outcomeCode","terminalFailureVerified","submittedVerified","accountAction","retryMode","failureEvidence","monitorError","monitorProbe"])assert(Object.prototype.hasOwnProperty.call(reloaded,key),key);});

const failed = checks.filter(item=>!item.ok);
const report = {test:"doubao-failure-persistence",timestamp:new Date().toISOString(),groundTruth:truthPath,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive:true});
fs.writeFileSync(path.join(logDir, "doubao-failure-persistence.json"), JSON.stringify(report, null, 2));
console.log(`DOUBAO_FAILURE_PERSISTENCE ${report.passed}/${report.total}`);
if (failed.length) { for (const item of failed) console.error(item.name, item.error); process.exit(1); }
