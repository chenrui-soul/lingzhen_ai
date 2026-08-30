const fs = require("fs");
const path = require("path");

const renderer = fs.readFileSync(path.resolve(__dirname, "../src/renderer/infinite-canvas.js"), "utf8");
const css = fs.readFileSync(path.resolve(__dirname, "../src/renderer/styles/infinite-canvas.css"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed, detail});
const section = (start, end) => {
  const from = renderer.indexOf(start);
  const to = renderer.indexOf(end, from + start.length);
  return from >= 0 ? renderer.slice(from, to >= 0 ? to : renderer.length) : "";
};

const nodeBinding = section("function bindNodes", "function bindEdges");
const groupBinding = section("function bindGroups", "function bindNodes");
const pointerMoveStart = renderer.lastIndexOf('window.addEventListener("pointermove"');
const pointerMoveEnd = renderer.indexOf("function finishDrag", pointerMoveStart);
const pointerMove = renderer.slice(pointerMoveStart, pointerMoveEnd);
const finishDrag = section("function finishDrag", 'window.addEventListener("pointerup"');
const keydown = section('window.addEventListener("keydown"', 'window.addEventListener("resize"');
const runSingle = section("async function runSingleNode", "async function runSequence");

check("节点按下不立即写历史", nodeBinding.includes("editorState:captureEditorState()") && !nodeBinding.includes("snapshot();runtime.selectedGroupIds"));
check("分组按下不立即写历史", groupBinding.includes("editorState:captureEditorState()") && !groupBinding.includes("snapshot();runtime.selectedGroupIds"));
check("拖动阈值为 4px", (pointerMove.match(/Math\.hypot\(dx,dy\)<4/g) || []).length === 2);
check("真实拖动才提交一次历史", (pointerMove.match(/if\(!drag\.moved\)\{drag\.moved=true;drag\.committed=true;snapshot\(\)/g) || []).length === 2);
check("拖动中隐藏编辑区并关闭菜单", renderer.includes("function setEditorHiddenOnDrag") && pointerMove.includes("setEditorHiddenOnDrag(true)") && renderer.includes("if(hidden)closeMenus()"));
check("节点拖动只更新坐标连线和分组", pointerMove.includes("refreshGroups();refreshGroupCards();redrawEdges();") && !pointerMove.includes("renderCanvasModule()") && !pointerMove.includes("positionComposer"));
check("释放后节点恢复拖动前编辑器状态", finishDrag.includes("restoreEditorAfterDrag(drag.editorState);") && !finishDrag.includes("restoreEditorAfterDrag(drag.editorState,drag.id,true)"));
check("释放后分组恢复拖动前编辑状态", finishDrag.includes("restoreEditorAfterDrag(drag.editorState);"));
check("拖动完成阻止误点击", renderer.includes("dragJustFinished:false") && nodeBinding.includes("if(runtime.dragJustFinished)") && groupBinding.includes("if(runtime.dragJustFinished)"));
check("Esc 优先取消并恢复拖动", keydown.includes('event.key==="Escape"&&(runtime.nodeDrag||runtime.groupDrag)') && keydown.indexOf("cancelNodeDrag") < keydown.indexOf('event.target.matches("input,textarea,select")'));
check("取消拖动移除新增历史", renderer.includes("runtime.history.length=drag.historyLength") && renderer.includes("runtime.future=drag.futureBefore"));
check("编辑区隐藏保持右栏布局", css.includes(".shell.lfc-editor-hidden-on-drag .right{visibility:hidden;pointer-events:none}") && css.includes(".lfc-node-composer-host.lfc-editor-hidden-on-drag"));
check("运行中节点阻止重复提交", runSingle.includes("activeStates.has(node.data?.status)") && runSingle.includes("该节点正在运行"));
check("运行按钮只按当前节点状态禁用", renderer.includes('data-lfc-run-node="${esc(node.id)}" ${activeStates.has(status)?"disabled":""}') && renderer.includes("const running=node&&activeStates.has(node.data?.status)"));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test: "infinite-canvas-phase3-node-interaction", total: results.length, passed: results.length - failed.length, failed: failed.length, results}, null, 2));
process.exitCode = failed.length ? 1 : 0;
