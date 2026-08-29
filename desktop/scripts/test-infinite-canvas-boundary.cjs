"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const canvas = read("src/renderer/infinite-canvas.js");
const core = read("src/renderer/canvas-flow-core.js");
const adapter = read("src/renderer/canvas-input-adapter.js");
const index = read("src/renderer/index.html");
const results = [];
const check = (name, condition, detail = "") => results.push({name, passed: Boolean(condition), detail: condition ? "" : detail});

check("画布不直接依赖 Electron 主进程", !/(ipcRenderer|BrowserWindow|ipcMain|src[\\/]main|generation-orchestrator)/.test(`${canvas}\n${core}\n${adapter}`));
check("画布执行只使用统一 generation.create", (canvas.match(/api\.generation\.create\s*\(/g) || []).length === 1);
check("画布任务保留独立 creationSource", canvas.includes('creationSource:"infinite-canvas-v2"'));
check("画布任务保存 canvasId", canvas.includes("canvasId:runtime.activeId") || (canvas.includes("canvasId = runtime.activeId") && /canvasId,\s*\n\s*canvasNodeId:node\.id/.test(canvas)));
check("画布任务保存 canvasNodeId", canvas.includes("canvasNodeId:node.id"));
check("画布不直接调用任务中心写接口", !/api\.tasks\.(create|report|complete|retry|cancel|archive|delete)/.test(canvas));
check("画布不直接调用豆包窗口控制接口", !/api\.doubao\.(open|close|popout|setBounds|setPageActive)/.test(canvas));
check("画布不直接调用模型网关写接口", !/api\.models\.(createProvider|updateProvider|deleteProvider|testProvider|discover|addModel|updateModel|deleteModel)/.test(canvas));
check("画布只通过既有工作台读取项目数据", (canvas.match(/api\.workbench\.bootstrap\s*\(/g) || []).length >= 2);
check("画布入口保留核心脚本顺序", index.indexOf("canvas-flow-core.js") < index.indexOf("app.js") && index.indexOf("infinite-canvas.js") > index.indexOf("desktop-ui.js"));
check("画布入口加载媒体 V2 样式", index.includes("canvas-media-v2.css"));
check("画布入口加载输入适配层", index.includes("canvas-input-adapter.js") && index.indexOf("canvas-flow-core.js") < index.indexOf("canvas-input-adapter.js") && index.indexOf("canvas-input-adapter.js") < index.indexOf("infinite-canvas.js"));
check("画布存储键包含租户和项目", canvas.includes("lingframe.infiniteCanvas.v2.") && canvas.includes("runtime.tenantId") && canvas.includes("runtime.projectId"));

const failed = results.filter(item => !item.passed);
const output = {test: "infinite-canvas-boundary", at: new Date().toISOString(), total: results.length, passed: results.length - failed.length, failed: failed.length, results};
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive: true});
fs.writeFileSync(path.join(logDir, "infinite-canvas-boundary.json"), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
if (failed.length) process.exitCode = 1;
