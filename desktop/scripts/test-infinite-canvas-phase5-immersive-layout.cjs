const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer/infinite-canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles/infinite-canvas.css"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed, detail});

check("沉浸模式有独立持久化状态", renderer.includes("immersive:true") && renderer.includes("immersive:runtime.immersive!==false") && renderer.includes("runtime.immersive = value?.immersive !== false"));
check("画布页面隐藏通用页面头和底部状态栏", css.includes(".shell.lfc-page-active.lfc-immersive .page-head{display:none") && css.includes(".shell.lfc-page-active.lfc-immersive .statusbar{display:none"));
check("工作区无外边距并占满客户区", css.includes(".shell.lfc-page-active.lfc-immersive .workspace{padding:0!important") && css.includes(".lfc-stage.immersive{height:100%"));
check("资源库改为覆盖式抽屉", css.includes(".lfc-stage.immersive .lfc-library{position:absolute") && css.includes(".lfc-stage.immersive .lfc-main{width:100%;height:100%"));
check("检查器改为覆盖式抽屉", css.includes(".shell.lfc-page-active.lfc-immersive .right{position:absolute") && css.includes("lfc-inspector-collapsed .right{width:52px"));
check("面板切换不调用适应画布", renderer.includes("runtime.leftCollapsed=!runtime.leftCollapsed;runtime.composerLayout=null;markDirty();renderCanvasModule()") && renderer.includes("runtime.inspectorCollapsed=!runtime.inspectorCollapsed;runtime.composerLayout=null;markDirty();renderCanvasModule()"));
check("提供沉浸模式切换按钮", renderer.includes("data-lfc-toggle-immersive") && renderer.includes("runtime.immersive=runtime.immersive===false"));
check("低频操作使用图标与辅助标签", renderer.includes("aria-label=\"画布主题\"") && renderer.includes("aria-label=\"导出工作流\"") && renderer.includes("aria-label=\"导入工作流\""));
check("画布工具保留 Tooltip 和 aria-label", renderer.includes("aria-label=\"选择与框选（V）\"") && renderer.includes("aria-label=\"平移画布（H）\"") && css.includes(".lfc-stage.immersive .lfc-canvas-tools button span{display:none"));
check("统一键盘焦点样式", css.includes(".lfc-stage.immersive button:focus-visible") && css.includes(".lfc-stage.immersive input:focus-visible"));
check("窄屏仍保留可用的检查器入口", css.includes("@media(max-width:980px)") && css.includes(".shell.lfc-page-active.lfc-immersive .right{width:52px"));
check("清理页面状态时移除沉浸模式", renderer.includes('classList.remove("lfc-page-active","lfc-inspector-collapsed","lfc-immersive")'));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test:"infinite-canvas-phase5-immersive-layout",total:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2));
process.exitCode = failed.length ? 1 : 0;
