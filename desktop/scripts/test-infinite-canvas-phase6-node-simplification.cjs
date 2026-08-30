const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const canvasCore = require(path.join(root, "src/renderer/canvas-flow-core.js"));
const core = fs.readFileSync(path.join(root, "src/renderer/canvas-flow-core.js"), "utf8");
const renderer = fs.readFileSync(path.join(root, "src/renderer/infinite-canvas.js"), "utf8");
const plan = fs.readFileSync(path.join(root, "..", "docs", "infinite-canvas-optimization-plan.md"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed, detail});

const minimalTypes = ["text", "image-input", "video-input", "audio-input", "asset", "image-generation", "video-generation", "prompt"];
const legacyTypes = ["story-outline", "episode-script", "final-cut"];

check(
  "核心节点库定义精简节点白名单",
  JSON.stringify(canvasCore.MINIMAL_NODE_TYPES) === JSON.stringify(minimalTypes)
);
check(
  "精简模式只筛选白名单节点",
  canvasCore.nodeLibraryForMode("minimal").length === minimalTypes.length &&
    minimalTypes.every(type => canvasCore.nodeLibraryForMode("minimal").some(item => item.type === type)) &&
    legacyTypes.every(type => !canvasCore.nodeLibraryForMode("minimal").some(item => item.type === type))
);
check(
  "默认模板仍为空白画布",
  canvasCore.createTemplateDocument().metadata.templateId === "blank" &&
    canvasCore.createTemplateDocument().nodes.length === 0 &&
    renderer.includes('makeCanvas("未命名画布", "blank")')
);
check(
  "旧短剧模板仍保留显式兼容生成",
  canvasCore.createTemplateDocument("short-drama").metadata.templateId === "short-drama" &&
    canvasCore.createTemplateDocument("short-drama").nodes.length === 12 &&
    canvasCore.createTemplateDocument("short-drama").edges.length === 14
);
check(
  "短剧历史画布使用完整节点库",
  renderer.includes('const legacy=canvas?.templateId==="short-drama"') &&
    renderer.includes('core.nodeLibraryForMode(legacy?"short-drama":"minimal")')
);
check(
  "普通历史画布追加已有高级节点",
  renderer.includes('historical=core.nodeLibraryForMode("short-drama")') &&
    renderer.includes("canvas.document.nodes.some(node=>node.data?.kind===item.type)")
);
check(
  "右键快速创建遵循当前画布节点库",
  renderer.includes("const compatible=canvasNodeLibrary().filter") &&
    !renderer.includes("const compatible=core.nodeLibraryForMode(canvasMode()).filter")
);
check(
  "无画布初始化不再创建短剧流程",
  renderer.includes('if (!canvases.length) canvases.push(makeCanvas("未命名画布", "blank"))') &&
    !renderer.includes('makeCanvas("短剧生产流程 V1", "short-drama")')
);
check(
  "模板弹窗不再显示短剧模板按钮",
  renderer.includes('<button data-template="blank">') &&
    !renderer.includes('<button data-template="short-drama"><i>▶</i>')
);
check(
  "左侧新建入口不再暗示短剧模板",
  renderer.includes("<strong>新建空白画布</strong><small>从节点库或创作台开始</small>") &&
    !renderer.includes("<small>空白画布 / 短剧生产模板</small>")
);
check(
  "首屏不暴露短剧快捷入口",
  renderer.includes('$(`[data-lfc-quick-start=\'short-drama\']`,hero)?.remove()') ||
    renderer.includes("$(`[data-lfc-quick-start='short-drama']`,hero)?.remove()") ||
    renderer.includes("$([\"data-lfc-quick-start='short-drama'\"],hero)?.remove()") ||
    renderer.includes("$(\"[data-lfc-quick-start='short-drama']\",hero)?.remove()")
);
check(
  "保留短剧快捷入口兼容分支但不作为模板默认入口",
  renderer.includes('if(action==="short-drama")') && renderer.includes('createTemplateDocument("short-drama")')
);
check(
  "不删除历史任务与结果绑定能力",
  renderer.includes("jobIds") && renderer.includes("activeResultId") && renderer.includes("lastInputFingerprint")
);
check(
  "阶段六执行状态已记录",
  plan.includes("### 阶段六：节点精简和历史兼容") && plan.includes("执行状态：已完成")
);

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({
  test: "infinite-canvas-phase6-node-simplification",
  total: results.length,
  passed: results.length - failed.length,
  failed: failed.length,
  results
}, null, 2));
process.exitCode = failed.length ? 1 : 0;
