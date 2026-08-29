"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src", "renderer", "task-center.js"), "utf8");
const wait = delay => new Promise(resolve => setTimeout(resolve, delay));

function task(state, patch = {}) {
  return {
    id: "task-live-refresh",
    projectId: "project-1",
    title: "一只会跳的猪",
    prompt: "一只会跳的猪",
    executionChannel: "doubao",
    accountId: "account-2",
    accountName: "豆包2",
    state,
    statusText: state === "completed" ? "生成完成" : "正在生成",
    progress: state === "completed" ? 100 : 45,
    progressMode: state === "completed" ? "determinate" : "indeterminate",
    assetIds: [],
    steps: [{at: new Date().toISOString(), state, message: state === "completed" ? "结果已回填" : "正在生成"}],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...patch
  };
}

function createHarness({activePage = "tasks", initialTask = task("generating"), bootstrapDelay = 0, bootstrapError = null} = {}) {
  let currentPage = activePage;
  let bootstrapCalls = 0;
  let snapshot = {
    currentProjectId: "project-1",
    projects: [{id: "project-1", name: "测试项目"}],
    tasks: [initialTask],
    assets: []
  };
  const windowListeners = new Map();
  const observers = [];
  const workspace = {
    innerHTML: "",
    querySelector: () => null,
    querySelectorAll: () => []
  };
  const document = {
    body: {appendChild() {}},
    querySelector(selector) {
      if (selector === ".nav.active") return {dataset: {page: currentPage}};
      if (selector === ".workspace") return workspace;
      return null;
    },
    querySelectorAll: () => [],
    addEventListener() {},
    createElement() {
      return {style: {}, dataset: {}, querySelector: () => null, querySelectorAll: () => [], appendChild() {}, remove() {}, select() {}};
    },
    execCommand: () => true
  };
  class MutationObserver {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe() {}
  }
  const lingframe = {
    workbench: {bootstrap: async () => { bootstrapCalls += 1; if (bootstrapDelay) await wait(bootstrapDelay); if (bootstrapError) throw bootstrapError; return structuredClone(snapshot); }},
    tasks: {},
    assets: {open: async () => ({ok: true})}
  };
  const window = {
    lingframe,
    addEventListener(type, callback) {
      const callbacks = windowListeners.get(type) || [];
      callbacks.push(callback);
      windowListeners.set(type, callbacks);
    }
  };
  const context = {
    window,
    document,
    MutationObserver,
    requestAnimationFrame: callback => setTimeout(callback, 0),
    queueMicrotask,
    setTimeout,
    clearTimeout,
    structuredClone,
    navigator: {},
    console,
    Date,
    Math,
    Set,
    Promise
  };
  vm.runInNewContext(renderer, context, {filename: "src/renderer/task-center.js"});
  return {
    workspace,
    get bootstrapCalls() { return bootstrapCalls; },
    setPage(value) { currentPage = value; },
    setSnapshot(value) { snapshot = value; },
    emit(detail) { for (const callback of windowListeners.get("lingframe:generation-status") || []) callback({detail}); },
    triggerMutations() { for (const observer of observers) observer.callback(); }
  };
}

async function main() {
  const checks = [];
  async function check(name, run) {
    try {
      await run();
      checks.push({name, ok: true});
    } catch (error) {
      checks.push({name, ok: false, error: String(error.message || error)});
    }
  }

  await check("完成状态立即刷新任务中心与结果素材", async () => {
    const harness = createHarness();
    await wait(30);
    assert.equal(harness.bootstrapCalls, 1);
    assert(harness.workspace.innerHTML.includes("正在生成"));
    const completed = task("completed", {resultAssetId: "asset-1", resultVid: "video-url"});
    harness.setSnapshot({currentProjectId: "project-1", projects: [{id: "project-1", name: "测试项目"}], tasks: [completed], assets: [{id: "asset-1", name: "一只会跳的猪-豆包生成视频", type: "video", size: 2700000}]});
    harness.emit({taskId: completed.id, state: "completed", resultAssetId: "asset-1"});
    await wait(40);
    assert.equal(harness.bootstrapCalls, 2);
    assert(harness.workspace.innerHTML.includes("已完成"));
    assert(harness.workspace.innerHTML.includes("结果已回填"));
    assert(harness.workspace.innerHTML.includes("一只会跳的猪-豆包生成视频"));
  });

  await check("普通进度心跳合并为一次后台刷新", async () => {
    const harness = createHarness();
    await wait(30);
    for (let index = 0; index < 5; index += 1) harness.emit({taskId: "task-live-refresh", state: "generating", progress: 46 + index});
    await wait(100);
    assert.equal(harness.bootstrapCalls, 1);
    await wait(240);
    assert.equal(harness.bootstrapCalls, 2);
  });

  await check("离开任务中心时标记过期并在返回时刷新", async () => {
    const harness = createHarness({activePage: "home"});
    await wait(30);
    const completed = task("completed");
    harness.setSnapshot({currentProjectId: "project-1", projects: [{id: "project-1", name: "测试项目"}], tasks: [completed], assets: []});
    harness.emit({taskId: completed.id, state: "completed"});
    await wait(30);
    assert.equal(harness.bootstrapCalls, 1);
    harness.setPage("tasks");
    harness.triggerMutations();
    await wait(40);
    assert.equal(harness.bootstrapCalls, 2);
    assert(harness.workspace.innerHTML.includes("已完成"));
  });

  await check("刷新进行中收到终态事件时不丢失最新状态", async () => {
    const harness = createHarness({bootstrapDelay: 35});
    await wait(8);
    const completed = task("completed");
    harness.setSnapshot({currentProjectId: "project-1", projects: [{id: "project-1", name: "测试项目"}], tasks: [completed], assets: []});
    harness.emit({taskId: completed.id, state: "completed"});
    await wait(100);
    assert.equal(harness.bootstrapCalls, 2);
    assert(harness.workspace.innerHTML.includes("已完成"));
  });

  await check("后台读取失败时不会进入无限刷新", async () => {
    const harness = createHarness({bootstrapError: new Error("模拟后台读取失败")});
    await wait(80);
    assert.equal(harness.bootstrapCalls, 1);
  });

  const failed = checks.filter(item => !item.ok);
  const result = {test: "task-center-live-refresh", total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks};
  console.log(JSON.stringify(result, null, 2));
  if (failed.length) process.exitCode = 1;
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
