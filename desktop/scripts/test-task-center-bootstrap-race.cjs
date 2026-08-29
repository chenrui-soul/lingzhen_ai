"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(
  path.join(root, "references", "task-center-bootstrap-race-ground-truth.json"),
  "utf8",
));
const source = fs.readFileSync(path.join(root, "src", "renderer", "task-center.js"), "utf8");

let activePage = "home";
let bootstrapCalls = 0;
let authChanged = null;
const task = {
  id: truth.expected.taskId,
  title: truth.expected.taskTitle,
  prompt: "启动竞态回归",
  state: "completed",
  statusText: "结果已校验并回填素材中心",
  projectId: "project-1",
  executionChannel: "doubao",
  accountId: "account-1",
  accountName: "测试账号",
  progress: 100,
  steps: [],
  createdAt: "2026-08-26T00:00:00.000Z",
  updatedAt: "2026-08-26T00:01:00.000Z",
};
const workspace = {
  html: "",
  set innerHTML(value) { this.html = String(value); },
  get innerHTML() { return this.html; },
  querySelector() { return null; },
  querySelectorAll() { return []; },
};
const document = {
  body: {},
  querySelector(selector) {
    if (selector === ".nav.active") return {dataset:{page:activePage}};
    if (selector === ".workspace") return workspace;
    return null;
  },
  addEventListener() {},
  createElement() { return {className:"",dataset:{},style:{},appendChild(){},remove(){},querySelector(){return null;},querySelectorAll(){return[];}}; },
};
class MutationObserver { observe() {} }
const api = {
  auth:{onChanged:handler=>{authChanged=handler;}},
  tasks:{},
  workbench:{
    bootstrap:async()=>{
      bootstrapCalls += 1;
      if (bootstrapCalls === 1) return {locked:truth.expected.firstResponseLocked,currentProjectId:null,projects:[],assets:[],tasks:[]};
      return {
        currentProjectId:"project-1",
        projects:[{id:"project-1",name:"默认项目"}],
        assets:[],
        tasks:[task],
      };
    },
  },
};
const context = {
  console,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  requestAnimationFrame:callback=>callback(),
  MutationObserver,
  document,
  navigator:{clipboard:{writeText:async()=>{}}},
};
context.window = {
  lingframe:api,
  addEventListener() {},
};

vm.runInNewContext(source, context, {filename:"task-center.js"});

(async()=>{
  await new Promise(resolve=>setTimeout(resolve, 20));
  assert.equal(bootstrapCalls, 1, "首次 loading 期间只读取一次空工作台");
  assert.equal(typeof authChanged, "function", "任务中心必须订阅身份状态变化");

  activePage = "tasks";
  authChanged({workspaceReady:true,tenantId:"tenant-test"});
  await new Promise(resolve=>setTimeout(resolve, 30));

  const checks = [
    ["工作台就绪后自动重新读取任务", bootstrapCalls === truth.expected.bootstrapCalls],
    ["恢复任务标题", workspace.html.includes(truth.expected.taskTitle)],
    ["恢复任务 ID", workspace.html.includes(truth.expected.taskId)],
    ["已完成数量正确", workspace.html.includes(`<b>${truth.expected.completedCount}</b>`)],
    ["不再显示空任务提示", !workspace.html.includes("没有找到任务")],
    ["身份 loading 阶段未覆盖本地文件", truth.expected.firstResponseLocked === true],
  ];
  for (const [name, passed] of checks) assert.equal(passed, true, name);

  const report = {
    test:truth.test,
    total:checks.length,
    passed:checks.length,
    failed:0,
    bootstrapCalls,
    taskId:task.id,
    generatedAt:new Date().toISOString(),
  };
  const logDir = path.join(root, "scripts", "log");
  fs.mkdirSync(logDir, {recursive:true});
  fs.writeFileSync(path.join(logDir, "task-center-bootstrap-race.json"), JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
})().catch(error=>{console.error(error.stack||error);process.exit(1);});
