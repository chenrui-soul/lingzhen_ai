"use strict";

const assert = require("assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const {DoubaoAccountRegistry} = require("../src/main/doubao-account-registry.cjs");
const {WorkbenchDataBridge} = require("../src/main/workbench-data-bridge.cjs");
const {GenerationOrchestrator} = require("../src/main/generation-orchestrator.cjs");
const {AgentBridge} = require("../src/main/agent-bridge.cjs");
const {BrowserController} = require("../src/main/browser-controller.cjs");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "doubao-tenant-account-isolation-ground-truth.json"), "utf8"));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lingframe-account-isolation-"));
let tenantId = "tenant-A";
const tenantRoot = () => path.join(temp, "tenants", tenantId);
const registry = new DoubaoAccountRegistry({tenantRootProvider: tenantRoot});
const checks = [];
async function check(name, operation) {
  try { await operation(); checks.push({name, ok:true}); }
  catch (error) { checks.push({name, ok:false, detail:String(error.stack || error)}); }
}

(async () => {
  await check("首次启动只迁移当前租户账号", () => {
    fs.mkdirSync(path.join(tenantRoot(), "embedded-browser-profiles", "account-a"), {recursive:true});
    const value = registry.bootstrap({legacyAccounts:[{id:"account-b",name:"账号 B"}]});
    assert.deepEqual(value.accounts.map(item=>item.id).sort(), ["account-a","account-b"]);
  });

  await check("无真实浏览器资料时不迁移历史占位账号", () => {
    tenantId="tenant-placeholder-empty";
    const value=registry.bootstrap({legacyAccounts:[{id:"desktop-1",name:"历史占位账号"},{id:"custom-account",name:"自定义账号"}]});
    assert.deepEqual(value.accounts.map(item=>item.id),["custom-account"]);
  });

  await check("存在当前租户浏览器资料时允许迁移同名占位账号", () => {
    tenantId="tenant-placeholder-profile";
    fs.mkdirSync(path.join(tenantRoot(),"embedded-browser-profiles","desktop-1"),{recursive:true});
    const value=registry.bootstrap({legacyAccounts:[{id:"desktop-1",name:"历史占位账号"}]});
    assert.deepEqual(value.accounts.map(item=>item.id),["desktop-1"]);
    tenantId="tenant-A";
  });

  await check("不同用户或租户使用独立账号注册表", () => {
    tenantId = "tenant-B";
    const value = registry.bootstrap({legacyAccounts:[{id:"account-c",name:"账号 C"}]});
    assert.deepEqual(value.accounts.map(item=>item.id), ["account-c"]);
    assert.throws(()=>registry.assert("account-a"), error=>error.code===truth.errorCode);
  });

  await check("切回原密钥恢复原账号而不是新租户账号", () => {
    tenantId = "tenant-A";
    assert.deepEqual(registry.list().map(item=>item.id).sort(), ["account-a","account-b"]);
    assert.throws(()=>registry.assert("account-c"), error=>error.code===truth.errorCode);
  });

  await check("渲染层只采用主进程返回的当前租户账号", async () => {
    const source=fs.readFileSync(path.join(root,"src","renderer","account-store.js"),"utf8");
    const storage={
      "lingframe.doubaoAccounts.tenant-A":JSON.stringify([{id:"account-a",name:"本租户本地缓存"}]),
      "lingframe.doubaoAccounts.tenant-B":JSON.stringify([{id:"account-c",name:"其他租户缓存"}])
    };
    const context={window:{lingframe:{identity:{status:async()=>({tenantId:"tenant-A"})},doubaoAccounts:{bootstrap:async()=>({tenantId:"tenant-A",accounts:[{id:"account-a",name:"主进程账号 A"}]})}}},localStorage:{getItem:key=>storage[key]??null,setItem:(key,value)=>{storage[key]=String(value)}},CustomEvent:function(type,init){this.type=type;this.detail=init?.detail},setTimeout,clearTimeout,console};
    context.window.window=context.window;context.window.dispatchEvent=()=>{};vm.createContext(context);vm.runInContext(source,context);
    await context.window.lingframeAccountStore.ready;
    const accounts=context.window.lingframeAccountStore.accounts();
    assert.equal(JSON.stringify(accounts.map(item=>item.id)),JSON.stringify(["account-a"]));
    assert.equal(accounts[0].name,"主进程账号 A");
  });

  await check("任务创建拒绝混入其他用户账号的候选池", async () => {
    tenantId="tenant-A";
    const bridge=new WorkbenchDataBridge({tenantRootProvider:tenantRoot});const project=bridge.bootstrap().projects[0];
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:bridge,modelGateway:{},agentBridge:{browser:{}},accountRegistry:registry,dataRootProvider:tenantRoot});
    runtime.run=async()=>{};
    await assert.rejects(()=>runtime.create({projectId:project.id,title:"越权候选",prompt:"测试",executionChannel:"doubao",accountSelectionMode:"auto",accountId:"account-a",accountCandidates:[{id:"account-a"},{id:"account-c"}]}),error=>error.code===truth.errorCode);
    assert.equal(bridge.bootstrap().tasks.length,0);
  });

  await check("合法任务只保存当前用户账号", async () => {
    const bridge=new WorkbenchDataBridge({tenantRootProvider:tenantRoot});const project=bridge.bootstrap().projects[0];
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:bridge,modelGateway:{},agentBridge:{browser:{}},accountRegistry:registry,dataRootProvider:tenantRoot});runtime.run=async()=>{};
    const task=await runtime.create({projectId:project.id,title:"合法候选",prompt:"测试",executionChannel:"doubao",accountSelectionMode:"auto",accountId:"account-a",accountCandidates:[{id:"account-a"},{id:"account-b"}]});
    assert.deepEqual(task.accountCandidates.map(item=>item.id).sort(),["account-a","account-b"]);
  });

  await check("普通 tasks:create 入口只能保存无执行账号的草稿", () => {
    const bridge=new WorkbenchDataBridge({tenantRootProvider:tenantRoot});const project=bridge.bootstrap().projects[0];
    const draft=bridge.createDraftTask({projectId:project.id,title:"安全草稿",prompt:"仅保存草稿",state:"draft"});
    assert.equal(draft.state,"draft");assert.equal(draft.executionChannel,"");assert.equal(draft.accountId,"");assert.deepEqual(draft.accountCandidates,[]);
    assert.throws(()=>bridge.createDraftTask({projectId:project.id,title:"伪造任务",prompt:"越权",state:"queued",executionChannel:"doubao",accountId:"account-c"}),error=>error.code==="TASK_DRAFT_ONLY");
  });

  await check("旧任务重试时过滤其他用户账号并重新绑定当前账号", async () => {
    const bridge=new WorkbenchDataBridge({tenantRootProvider:tenantRoot});const project=bridge.bootstrap().projects[0];
    const original=bridge.createTask({projectId:project.id,title:"旧混合候选任务",prompt:"安全重试",executionChannel:"doubao",state:"failed",accountSelectionMode:"auto",accountId:"account-c",accountName:"其他租户账号",accountCandidates:[{id:"account-c"},{id:"account-b"}],safeToRetry:true,terminalFailureVerified:true});
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:bridge,modelGateway:{},agentBridge:{browser:{}},accountRegistry:registry,dataRootProvider:tenantRoot});runtime.run=async()=>{};
    const child=await runtime.retryTask(original.id);
    assert.equal(child.accountId,"account-b");assert.deepEqual(child.accountCandidates.map(item=>item.id),["account-b"]);
  });

  await check("旧自动任务恢复时过滤越权账号", () => {
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:{},modelGateway:{},agentBridge:{},accountRegistry:registry,dataRootProvider:tenantRoot});
    const candidates=runtime.doubaoCandidates({accountSelectionMode:"auto",accountId:"account-c",accountCandidates:[{id:"account-c"},{id:"account-b"}]});
    assert.deepEqual(candidates.map(item=>item.id),["account-b"]);
  });

  await check("历史提交未知任务不会打开其他用户账号", () => {
    const bridge=new WorkbenchDataBridge({tenantRootProvider:tenantRoot});const project=bridge.bootstrap().projects[0];let browserCalls=0;
    const legacy=bridge.createTask({projectId:project.id,title:"历史越权恢复",prompt:"不应监控",executionChannel:"doubao",state:"submission_unknown",accountId:"account-c",accountName:"其他用户账号",submittedVerified:true,evidence:{prompt:"不应监控",conversationId:"foreign-conversation",submittedAt:new Date().toISOString()}});
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:bridge,modelGateway:{},agentBridge:{browser:{execute:async()=>{browserCalls+=1}}},accountRegistry:registry,dataRootProvider:tenantRoot});
    runtime.recoverInterruptedTasks();const current=bridge.bootstrap().tasks.find(item=>item.id===legacy.id);
    assert.equal(current.state,"failed");assert.equal(current.failureCode,"DOUBAO_ACCOUNT_NOT_AUTHORIZED");assert.equal(browserCalls,0);assert.equal(runtime.unknownAuditTimers.has(legacy.id),false);runtime.dispose();
  });

  await check("历史已完成任务不会被授权恢复检查改写", () => {
    const bridge=new WorkbenchDataBridge({tenantRootProvider:tenantRoot});const project=bridge.bootstrap().projects[0];
    const completed=bridge.createTask({projectId:project.id,title:"历史已完成",prompt:"保留结果",executionChannel:"doubao",state:"completed",accountId:"account-c",accountName:"历史账号",progress:100,statusText:"结果已完成",submittedVerified:true});
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:bridge,modelGateway:{},agentBridge:{browser:{execute:async()=>{throw new Error("不应执行")}}},accountRegistry:registry,dataRootProvider:tenantRoot});runtime.recoverInterruptedTasks();
    const current=bridge.bootstrap().tasks.find(item=>item.id===completed.id);assert.equal(current.state,"completed");assert.equal(current.statusText,"结果已完成");runtime.dispose();
  });

  await check("浏览器命令发送前再次拒绝越权账号", async () => {
    let browserCalls=0;const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:{},modelGateway:{},agentBridge:{browser:{execute:async()=>{browserCalls+=1}}},accountRegistry:registry,dataRootProvider:tenantRoot});
    await assert.rejects(()=>runtime.executeBrowserTask({id:"foreign"},"monitor",{action:"monitor",account:{id:"account-c"}}),error=>error.code===truth.errorCode);
    assert.equal(browserCalls,0);runtime.dispose();
  });

  await check("删除账号前阻止仍绑定活跃任务的账号", () => {
    const account=registry.assertRemovable("account-a",[{id:"done",executionChannel:"doubao",accountId:"account-a",state:"completed"}]);
    assert.equal(account.id,"account-a");
    assert.throws(()=>registry.assertRemovable("account-a",[{id:"unknown",title:"待人工核对",executionChannel:"doubao",accountId:"account-a",state:"submission_unknown"}]),error=>error.code==="DOUBAO_ACCOUNT_IN_USE"&&error.taskIds.includes("unknown"));
    assert.throws(()=>registry.assertRemovable("account-a",[{id:"queued",title:"排队任务",executionChannel:"doubao",accountId:"account-a",state:"queued"}]),error=>error.code==="DOUBAO_ACCOUNT_IN_USE");
  });

  await check("账号删除时清理 Agent 浏览器会话与串行锁", async () => {
    const browser=new BrowserController({profileRootProvider:()=>path.join(tenantRoot(),"chrome-profiles"),testMode:true});
    await browser.open({id:"account-a",name:"账号 A"});
    browser.submissionTails.set("account-a",Promise.resolve());
    const closed=browser.closeAccount("account-a",{force:true});
    assert.equal(closed.ok,true);assert.equal(closed.closed,true);
    assert.equal(browser.sessions.has("account-a"),false);assert.equal(browser.submissionTails.has("account-a"),false);
  });

  await check("指定越权账号不会进入浏览器执行", () => {
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:{},modelGateway:{},agentBridge:{},accountRegistry:registry,dataRootProvider:tenantRoot});
    assert.throws(()=>runtime.doubaoCandidates({accountSelectionMode:"manual",accountId:"account-c"}),error=>error.code===truth.errorCode);
  });

  await check("Agent 本地入口也执行账号归属校验", async () => {
    const agentRoot=path.join(tenantRoot(),"agent-test");let browserCalls=0;
    const bridge=new AgentBridge({dataRoot:agentRoot,licenseClient:{status:()=>({tenantId}),credentials:()=>({})},identityProvider:()=>({tenantId,usable:true}),profileRootProvider:()=>path.join(tenantRoot(),"chrome-profiles"),accountAuthorizer:account=>registry.assert(account),testMode:true});
    bridge.browser.execute=async command=>{browserCalls+=1;return command.account};
    await assert.rejects(()=>bridge.openAccount({id:"account-c"}),error=>error.code===truth.errorCode);
    assert.equal(browserCalls,0);
    assert.equal((await bridge.openAccount({id:"account-a"})).id,"account-a");
    assert.equal(browserCalls,1);
    tenantId="tenant-B";
    await assert.rejects(()=>bridge.openAccount({id:"account-c"}),error=>error.code==="TENANT_CONTEXT_CHANGED");
    tenantId="tenant-A";bridge.stop();
    await assert.rejects(()=>bridge.openAccount({id:"account-a"}),error=>error.code==="AGENT_STOPPED");
  });

  await check("租户热切换后旧调度器上下文失效", () => {
    tenantId="tenant-A";const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:{},modelGateway:{},agentBridge:{},dataRootProvider:tenantRoot});
    tenantId="tenant-B";
    assert.throws(()=>runtime.tenantId(),error=>error.code==="TENANT_CONTEXT_CHANGED");
    tenantId="tenant-A";
  });

  await check("销毁旧调度器会释放账号锁并阻止后续写入", () => {
    const runtime=new GenerationOrchestrator({tenantIdProvider:()=>tenantId,tasks:{},modelGateway:{},agentBridge:{},dataRootProvider:tenantRoot});
    runtime.holdAccount({id:"held-task",accountId:"account-a"});assert.equal(runtime.accountLeases.size,1);
    runtime.dispose();assert.equal(runtime.accountLeases.size,0);assert.equal(runtime.accountOwners.size,0);
    assert.throws(()=>runtime.tenantId(),error=>error.code==="ORCHESTRATOR_DISPOSED");
  });

  await check("主进程账号与窗口入口均有后端校验", () => {
    const main=fs.readFileSync(path.join(root,"src","main","main.cjs"),"utf8");
    const embedded=fs.readFileSync(path.join(root,"src","main","embedded-browser-manager.cjs"),"utf8");
    assert.match(main,/doubaoAccounts\.assert\(account\)/);
    assert.match(main,/accountRegistry:doubaoAccounts/);
    assert.match(main,/refreshTenantRuntime\(previousTenantId\)/);
    assert.match(main,/workbenchData\.createDraftTask\(input\)/);
    assert.match(main,/generationOrchestrator\.retryTask\(taskId,input\|\|\{\}\)/);
    assert.match(main,/doubaoAccounts\.assert\(accountId\)\.id/);
    assert.match(main,/doubaoAccounts\.assertRemovable\(accountId,workbenchData\.bootstrap\(\)\.tasks\)/);
    assert.match(main,/agentBridge\?\.closeAccount\?\.\(account\)/);
    assert.match(main,/profileRootProvider: \(\) => \{assertRuntimeTenant\(\);return path\.join\(root, 'chrome-profiles'\);\}/);
    assert.match(embedded,/resetTenant\(\)/);
  });

  const failed=checks.filter(item=>!item.ok);const result={test:"doubao-tenant-account-isolation",timestamp:new Date().toISOString(),groundTruth:truth,total:checks.length,passed:checks.length-failed.length,failed:failed.length,checks};
  const logDir=path.join(root,"scripts","log");fs.mkdirSync(logDir,{recursive:true});fs.writeFileSync(path.join(logDir,"doubao-tenant-account-isolation.json"),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));if(failed.length)process.exitCode=1;
})().finally(()=>{try{fs.rmSync(temp,{recursive:true,force:true})}catch{}});
