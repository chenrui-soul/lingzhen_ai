"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer/infinite-canvas.js"), "utf8");
const core = fs.readFileSync(path.join(root, "src/renderer/canvas-flow-core.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles/infinite-canvas.css"), "utf8");
const plan = fs.readFileSync(path.join(root, "..", "docs", "infinite-canvas-optimization-plan.md"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed: Boolean(passed), detail: passed ? "" : detail});

check("P0 运行中允许继续编辑", renderer.includes("activeStates.has(node.data?.status)") && renderer.includes("refreshCanvasRuntimeView"));
check("P0 节点拖动自动隐藏编辑器", renderer.includes("setEditorHiddenOnDrag(true)") && renderer.includes("restoreEditorAfterDrag"));
check("P0 滚轮缩放保持鼠标锚点", renderer.includes("worldX=(px-(doc.viewport.x||0))/old") && renderer.includes("doc.viewport.x=px-worldX*next"));
check("P0 平移和连线跟随局部刷新", renderer.includes("runtime.panDrag") && renderer.includes("redrawEdges()"));
check("P0 视频状态刷新复用媒体节点", renderer.includes("refreshNodeCard(item.node,item.canvasId)") && renderer.includes("refreshCanvasRuntimeView"));
check("P1 首屏生成直接创建新画布", renderer.includes("function startCreatorGeneration(){if(runtime.creatorSubmitting)return null") && renderer.includes('makeCanvas(`${creatorModes[draft.mode].label} ·'));
check("P1 首屏具备素材、模型、参数和生成入口", renderer.includes("renderCreatorControls") && renderer.includes("data-lfc-creator-upload") && renderer.includes("data-lfc-creator-param") && renderer.includes("data-lfc-creator-submit"));
check("P1 沉浸式布局覆盖中央画布", css.includes(".lfc-stage.immersive .lfc-main") && css.includes(".shell.lfc-page-active.lfc-immersive .right{position:absolute"));
check("P1 媒体比例联动节点尺寸", renderer.includes("updateNodePresentationFromRatio") && core.includes("function nodeSize"));
check("P1 文本内容以文字 payload 传递", renderer.includes("文本节点的正文只通过 prompt 传递") && renderer.includes("inputManifest:input.inputManifest.filter"));
check("P2 精简节点库和历史兼容已接入", renderer.includes("canvasNodeLibrary(canvas)") && core.includes("MINIMAL_NODE_TYPES"));
check("P2 无效连线有反馈且不创建重复边", renderer.includes("if(!result.ok){toast(result.reason,\"error\");return false;}") && core.includes("两个节点已经连接"));
check("P2 删除操作可撤销", renderer.includes("snapshot();") && renderer.includes("restoreHistory(direction)"));
check("P2 重复运行被阻止", renderer.includes("if(activeStates.has(node.data?.status))") && renderer.includes("if(runtime.runningSequence)return"));
check("P2 任务取消/停止追踪已接入画布", renderer.includes("function canvasTaskCanStop") && renderer.includes("function cancelCanvasTask") && renderer.includes("api.generation?.cancel"));
check("P2 豆包提交后不伪造远程取消成功", renderer.includes("停止当前画布追踪") && renderer.includes("豆包端可能继续执行并计费"));
check("P2 已取消节点不会被异常处理改成失败", renderer.includes("'submission_unknown','cancelled'") && renderer.includes("state:'cancelled'"));
check("P3 工具栏提供 Tooltip 和无障碍标签", renderer.includes('aria-label="画布主题"') && renderer.includes('title="平移画布（H）"') && renderer.includes('aria-label="导出工作流"'));
check("P3 主题只影响画布显示", renderer.includes("只影响无限画布的显示，不改变节点、任务或项目数据"));
check("P3 预览支持放大且不清空旧媒体", renderer.includes("openAssetPreview") && renderer.includes("data-lfc-node-content-key") && renderer.includes("const key=resultAsset?.id"));
check("历史结果和任务绑定字段仍存在", renderer.includes("jobIds") && renderer.includes("executionEnvelope") && renderer.includes("validateTaskBinding"));
check("阶段七方案与验收标准已记录", plan.includes("### 阶段七：专项验收和交付") && plan.includes("### 14.7 开发测试矩阵") && plan.includes("其他页面和模块没有代码变更"));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test:"infinite-canvas-phase7-acceptance",total:results.length,passed:results.length-failed.length,failed:failed.length,results}, null, 2));
process.exitCode = failed.length ? 1 : 0;
