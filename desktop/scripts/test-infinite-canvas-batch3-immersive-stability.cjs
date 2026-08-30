"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer/infinite-canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles/infinite-canvas.css"), "utf8");
const plan = fs.readFileSync(path.join(root, "..", "docs", "infinite-canvas-ui-revision-plan-2026-08-30.md"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed: Boolean(passed), detail: passed ? "" : detail});

check("返回画布优先恢复已渲染快照", renderer.includes("warmRestore") && renderer.includes("runtime.sessionHydrated&&runtime.canvases.length>0") && renderer.includes('stage.className="lfc-stage"'));
check("返回画布后台刷新不显示全屏加载态", renderer.includes("const refresh=loadRuntimeData()") && renderer.includes("runtime.backgroundRefresh=refresh") && renderer.includes("后台刷新失败，已保留最近画布状态"));
check("后台刷新不会重复覆盖画布快照", renderer.includes("const shouldHydrate=!runtime.sessionHydrated") && renderer.includes("runtime.sessionHydrated=true"));
check("沉浸式工具栏具备多窗口断点", css.includes("@media(max-width:1280px)") && css.includes("@media(max-width:1080px)") && css.includes("@media(max-height:760px)"));
check("沉浸式层级避免工具栏被面板遮挡", css.includes(".lfc-commandbar{z-index:30}") && css.includes(".lfc-library{z-index:20}") && css.includes(".lfc-modal-host{z-index:12200}"));
check("弹层支持遮罩点击关闭", renderer.includes('event.target.classList?.contains("lfc-modal-backdrop")') && renderer.includes("data-lfc-asset-editor-close"));
check("弹层支持 Escape 关闭", renderer.includes('if(event.key!=="Escape")return') && renderer.includes("runtime.modal=null") && renderer.includes("closeCrossProjectPicker"));
check("弹层关闭尝试恢复焦点", renderer.includes("function rememberFocus") && renderer.includes("function restoreFocus") && renderer.includes("runtime.focusReturn"));
check("提交前停止不会创建远程任务", renderer.includes("function stopNodeBeforeSubmit") && renderer.includes("preSubmitStops") && renderer.includes("未创建远程任务"));
check("已提交豆包任务只停止追踪", renderer.includes("trackingOnly?null") && renderer.includes("已停止当前任务追踪") && renderer.includes("豆包端可能继续执行并计费"));
check("运行中节点禁止删除", renderer.includes("function runningNodesIn") && renderer.includes("运行中的节点不能删除"));
check("运行中删除节点的撤销受保护", renderer.includes("运行中节点不能被撤销或恢复删除"));
check("取消后迟到实时事件不会覆盖状态", renderer.includes("cancelledTaskIds.has(String(status.taskId))") && renderer.includes("api.generation?.onLiveStatus"));
check("取消后轮询停止并不会回填结果", renderer.includes("任务已取消或已停止追踪") && renderer.includes("if(runtime.cancelledTaskIds.has(String(taskId)))"));
check("运行现场统计限定当前画布", renderer.includes("function taskBelongsToCanvas") && renderer.includes("taskBelongsToCanvas(task,runtime.activeId)"));
check("第 3 批方案与交付边界一致", plan.includes("### 第 3 批：沉浸式和稳定性") && plan.includes("返回画布优先恢复快照") && plan.includes("补齐弹层 Escape、遮罩和焦点管理"));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test:"infinite-canvas-batch3-immersive-stability",total:results.length,passed:results.length-failed.length,failed:failed.length,results}, null, 2));
process.exitCode = failed.length ? 1 : 0;
