"use strict";

const {contextBridge} = require("electron");

const ok = value => Promise.resolve(JSON.parse(JSON.stringify(value ?? null)));
const noop = () => ok(null);
const project = {id: "project-home-parameter-test", name: "首页参数测试项目"};
const account = {id:"desktop-1",name:"白同学",platform:"豆包"};
const providers = [{
  id: "provider-test",
  name: "测试模型厂商",
  enabled: true,
  models: [
    {id: "text-model", displayName: "文本模型", enabled: true, capabilities: {type: "text", durations: [], resolutions: [], ratios: []}},
    {id: "image-model", displayName: "图片模型", enabled: true, capabilities: {type: "image", durations: [], resolutions: ["720p", "1080p"], ratios: ["1:1", "16:9"]}},
    {id: "video-model", displayName: "视频模型", enabled: true, parameters: {duration: "10s", resolution: "1080p"}, capabilities: {type: "video", durations: ["5s", "10s"], resolutions: ["720p", "1080p"], ratios: ["16:9", "9:16", "1:1"]}}
  ]
}];

contextBridge.exposeInMainWorld("lingframe", {
  window: {minimize: noop, toggleMaximize: noop, close: noop, isMaximized: () => ok(false)},
  app: {diagnostics: () => ok({test: true}), openExternal: noop},
  connection: {status: () => ok({ok:true,connected:true,mode:"test"}), refresh: () => ok({ok:true,connected:true,mode:"test"})},
  identity: {status: () => ok({tenantId: "tenant-home-parameter-test", usable: true, source: "verified-agent"})},
  license: {status: () => ok({usable: true, deviceSuffix: "TEST"}), activate: noop, refresh: () => ok({usable: true}), clear: noop},
  agent: {status: () => ok({online: true, deviceName: "test", agentId: "agent-test"}), configure: noop, openAccount: noop, detectAccount: noop},
  doubaoAccounts: {bootstrap: () => ok({tenantId:"tenant-home-parameter-test",accounts:[account]}), list: () => ok([account]), upsert: value => ok(value), remove: accountId => ok({ok:true,removed:true,accountId})},
  workbench: {bootstrap: () => ok({currentProjectId: project.id, projects: [project], assets: [], texts: [], tasks: []})},
  models: {bootstrap: () => ok(providers), createProvider: noop, updateProvider: noop, deleteProvider: noop, testProvider: noop, discover: () => ok([]), addModel: noop, updateModel: noop, deleteModel: noop},
  projects: {create: noop, update: noop, setCurrent: noop, delete: noop, restore: noop},
  assets: {list: () => ok([]), pickImport: () => ok([]), import: () => ok([]), update: noop, delete: noop, restore: noop, open: noop, showInFolder: noop, readText: () => ok({content: ""})},
  text: {create: noop, update: noop, delete: noop, restore: noop, restoreVersion: noop, deleteVersion: noop},
  tasks: {create: noop, report: noop, complete: noop, updateResultUrl: noop, cancel: noop, retry: noop, archive: noop, delete: noop, restore: noop},
  generation: {create: input => ok({id: "mock-task", title: input.title}), run: noop, resume: noop, monitor: noop, cancel: noop, onLiveView: () => {}, onLiveStatus: () => {}},
  doubao: {open: noop, detect: noop, close: noop, popout: noop, activateAccount: noop, hideAccount: noop, setBounds: noop, setPageActive: noop, status: () => ok({}), onStatus: () => {}}
});
