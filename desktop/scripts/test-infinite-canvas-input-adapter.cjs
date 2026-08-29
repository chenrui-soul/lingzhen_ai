"use strict";
const fs = require("fs");
const path = require("path");
const root = path.resolve(__dirname, "..");
const core = require(path.join(root, "src", "renderer", "canvas-flow-core.js"));
const adapter = require(path.join(root, "src", "renderer", "canvas-input-adapter.js"));
const results = [];
const check = (name, condition, detail = "") => results.push({name, passed:Boolean(condition), detail:condition ? "" : String(detail)});

const nodes = [
  {id:"idea", type:"lingframe", data:{kind:"text-input", title:"创意", content:"一只会飞的气球", refs:{assetIds:[]}}},
  {id:"noisy", type:"lingframe", data:{kind:"story-outline", title:"上游大纲", status:"completed", progress:100, runError:"不应进入提示词", updatedAt:"2099-01-01", results:[{description:"历史结果不应进入提示词"}], output:{type:"text", content:"第一幕发现气球", debug:"内部调试字段不应进入提示词", assetIds:["asset-character"]}, refs:{assetIds:["asset-character"], assetRoles:{"asset-character":"人物"}, jobIds:["job-1"]}}},
  {id:"prepared", type:"lingframe", data:{kind:"video-prompt", title:"视频提示词", status:"completed", output:{type:"text", content:"镜头从左向右推进，红色气球掠过城市"}, refs:{assetIds:[]}}},
  {id:"disabled", type:"lingframe", data:{kind:"text", title:"停用输入", content:"停用内容", refs:{assetIds:[]}}},
  {id:"video", type:"lingframe", data:{kind:"video-generation", title:"视频生成", instruction:"16:9，5秒", refs:{assetIds:["asset-local"], assetRoles:{"asset-local":"首帧"}}, modelParameters:{duration:"5s"}}}
];
const edges = [
  {id:"e-idea", source:"idea", target:"video", data:{order:20, role:"风格"}},
  {id:"e-noisy", source:"noisy", target:"video", data:{order:10, role:"人物"}},
  {id:"e-prepared", source:"prepared", target:"video", data:{order:1, role:""}},
  {id:"e-disabled", source:"disabled", target:"video", data:{order:5, enabled:false, role:"调试"}}
];
const envelope = adapter.resolveExecutionEnvelope("video", nodes, edges);
check("执行信封保留目标节点指令", envelope.prompt.includes("16:9，5秒"), envelope.prompt);
check("视频节点只接收直接的视频提示词", envelope.prompt.includes("镜头从左向右推进") && !envelope.prompt.includes("第一幕发现气球") && !envelope.prompt.includes("一只会飞的气球"), envelope.prompt);
check("停用输入不进入提示词", !envelope.prompt.includes("停用内容"), envelope.prompt);
check("运行元数据不进入提示词", !envelope.prompt.includes("不应进入提示词") && !envelope.prompt.includes("历史结果"), envelope.prompt);
check("素材引用保持独立", envelope.assetIds.includes("asset-character") && envelope.assetIds.includes("asset-local"), JSON.stringify(envelope.assetIds));
check("素材角色与上传顺序进入输入证据", envelope.inputManifest.some(item => item.assetId === "asset-character" && item.role === "人物") && envelope.inputManifest.some(item => item.assetId === "asset-local" && item.role === "首帧"), JSON.stringify(envelope.inputManifest));
check("任务引用不进入素材列表但保留上游追踪", !envelope.assetIds.includes("job-1") && envelope.upstream.jobIds.includes("job-1"), JSON.stringify(envelope.upstream));
check("输入证据不包含运行密钥类字段", !JSON.stringify(envelope.inputManifest).match(/cookie|api.?key|browser.?profile/i), JSON.stringify(envelope.inputManifest));
const valid = adapter.validateInputEnvelope(nodes[3], envelope);
check("执行信封契约校验通过", valid.ok, valid.errors.join("；"));

const current = core.resolveNodeExecutionInput("video", nodes, edges);
check("核心接口接入输入适配层", current.inputManifest?.length === envelope.inputManifest.length && current.prompt === envelope.prompt, JSON.stringify(current));

const output = {at:new Date().toISOString(), test:"infinite-canvas-input-adapter", passed:results.filter(item=>item.passed).length, failed:results.filter(item=>!item.passed).length, results};
const logDir = path.join(root, "scripts", "log");
fs.mkdirSync(logDir, {recursive:true});
fs.writeFileSync(path.join(logDir, "infinite-canvas-input-adapter.json"), JSON.stringify(output, null, 2), "utf8");
console.log(JSON.stringify(output, null, 2));
if (output.failed) process.exitCode = 1;
