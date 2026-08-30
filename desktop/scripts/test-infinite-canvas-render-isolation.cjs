const fs = require("fs");
const path = require("path");

const file = path.resolve(__dirname, "../src/renderer/infinite-canvas.js");
const source = fs.readFileSync(file, "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed, detail});
const section = (start, end) => {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  return from >= 0 ? source.slice(from, to >= 0 ? to : source.length) : "";
};

const awaitTask = section("async function awaitTask", "function resolveTaskOutput");
const syncCompletedTask = section("async function syncCompletedTask", "window.addEventListener(\"pointermove\"");
const liveStatus = section("api.generation?.onLiveStatus", "window.addEventListener(\"lingframe:account-groups-changed\"");

check("任务轮询使用局部刷新", awaitTask.includes("refreshCanvasRuntimeView") && !awaitTask.includes("renderCanvasModule()"));
check("任务完成同步不重建画布", syncCompletedTask.includes("refreshCanvasRuntimeView") && !syncCompletedTask.includes("renderCanvasModule()"));
check("实时状态不重建画布", liveStatus.includes("refreshCanvasRuntimeView") && !liveStatus.includes("renderCanvasModule()"));
check("节点存在稳定局部更新钩子", source.includes("data-lfc-node-content-key") && source.includes("function refreshNodeCard"));
check("媒体结果按内容 key 复用 DOM", source.includes("contentHost.dataset.lfcNodeContentKey!==String(content.key)") && source.includes("function nodeContentMarkup"));
check("运行现场支持独立刷新", source.includes("function refreshRunsDock") && source.includes("function refreshTaskButton"));
check("视口保存经过节流", source.includes("function scheduleViewportSave") && source.includes("scheduleViewportSave();"));
check("拖动过程与结束不触发全画布重绘", source.includes("function finishDrag()") && source.includes("refreshGroups();refreshGroupCards();restoreEditorAfterDrag") && source.includes("if(runtime.panDrag){runtime.panDrag=null;scheduleViewportSave();}"));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test: "infinite-canvas-render-isolation", total: results.length, passed: failed.length ? results.length - failed.length : results.length, failed: failed.length, results}, null, 2));
process.exitCode = failed.length ? 1 : 0;
