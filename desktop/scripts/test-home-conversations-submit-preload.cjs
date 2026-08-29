"use strict";

const {contextBridge} = require("electron");

const calls = [];
const project = {id: "project-home-phase1", name: "第一批首页测试项目"};
const account = {id: "desktop-1", name: "白同学", platform: "豆包", enabled: true};

const ok = value => Promise.resolve(value);
const noop = () => ok(null);
const api = {
  window: {minimize: noop, toggleMaximize: noop, close: noop, isMaximized: () => ok(false)},
  app: {diagnostics: () => ok({}), openExternal: noop},
  connection: {status: () => ok({ok: true, connected: true, mode: "test"}), refresh: () => ok({ok: true, connected: true, mode: "test"})},
  identity: {status: () => ok({tenantId: "tenant-home-phase1", usable: true, source: "test"})},
  license: {status: () => ok({valid: true, usable: true}), activate: noop, refresh: () => ok({valid: true, usable: true}), clear: noop},
  announcements: {list: () => ok([])},
  agent: {status: () => ok({}), configure: noop, openAccount: noop, detectAccount: noop},
  doubaoAccounts: {bootstrap: () => ok({tenantId:"tenant-home-phase1",accounts:[account]}), list: () => ok([account]), upsert: value => ok(value), remove: accountId => ok({ok:true,removed:true,accountId})},
  workbench: {bootstrap: () => ok({currentProjectId: project.id, projects: [project], assets: [], texts: [], tasks: []})},
  models: {bootstrap: () => ok([]), createProvider: noop, updateProvider: noop, deleteProvider: noop, testProvider: noop, discover: () => ok([]), addModel: noop, updateModel: noop, deleteModel: noop},
  projects: {create: noop, update: noop, setCurrent: noop, delete: noop, restore: noop},
  assets: {list: () => ok([]), pickImport: () => ok([]), import: () => ok([]), preview: noop, update: noop, delete: noop, restore: noop, open: noop, showInFolder: noop},
  text: {create: noop, update: noop, delete: noop, restore: noop, restoreVersion: noop, deleteVersion: noop},
  tasks: {create: noop, report: noop, complete: noop, updateResultUrl: noop, cancel: noop, retry: noop, archive: noop, delete: noop, restore: noop},
  generation: {
    create: input => {
      calls.push(JSON.parse(JSON.stringify(input)));
      return ok({id: `mock-task-${calls.length}`, title: input.title});
    },
    run: noop,
    resume: noop,
    monitor: noop,
    cancel: noop,
    onLiveView: () => {},
    onLiveStatus: () => {}
  },
  doubao: {open: noop, detect: noop, close: noop, popout: noop, activateAccount: noop, hideAccount: noop, setBounds: noop, setPageActive: noop, status: () => ok({}), onStatus: () => {}}
};

contextBridge.exposeInMainWorld("lingframe", api);
contextBridge.exposeInMainWorld("lingframeSubmitTest", {
  getCalls: () => JSON.parse(JSON.stringify(calls)),
  seedAccount: () => account
});
