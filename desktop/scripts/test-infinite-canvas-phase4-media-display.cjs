const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer/infinite-canvas.js"), "utf8");
const core = fs.readFileSync(path.join(root, "src/renderer/canvas-flow-core.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles/canvas-media-v2.css"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed, detail});

check("核心提供节点展示尺寸模型", core.includes("DEFAULT_NODE_PRESENTATIONS") && core.includes("normalizeNodePresentation") && core.includes("nodeSize"));
check("旧节点迁移补齐展示尺寸", core.includes("node.data.presentation = normalizeNodePresentation"));
check("分组边界使用动态节点尺寸", core.includes("+ nodeSize(node).width") && core.includes("+ nodeSize(node).height"));
check("节点卡片输出动态宽高", renderer.includes("const meta = canvasNodeMeta(node.data?.kind); const selected = runtime.selectedIds.includes(node.id); const stale = isStale(node); const size=core.nodeSize(node)") && renderer.includes("width:${size.width}px;height:${size.height}px"));
check("图片视频使用主体预览框", renderer.includes("lfc-node-media-frame") && renderer.includes("lfc-node-media-grid"));
check("媒体预览支持点击放大", renderer.includes("data-lfc-preview-asset") && renderer.includes("function bindPreviewTriggers"));
check("文本节点支持节点内编辑", renderer.includes("data-lfc-inline-editor") && renderer.includes("function bindInlineNodeEditor"));
check("文本输入不触发全画布重绘", renderer.includes("input.oninput=()=>") && renderer.includes("node.data.instruction=value") && !renderer.slice(renderer.indexOf("function bindInlineNodeEditor"), renderer.indexOf("function bindEdges")).includes("renderCanvasModule()"));
check("媒体自然比例更新使用局部刷新", renderer.includes("function bindMediaRatio") && renderer.includes("refreshGroups();refreshGroupCards();redrawEdges();markDirty();"));
check("手动尺寸不被媒体比例覆盖", renderer.includes("if(presentation.userResized)return false"));
check("生成比例联动节点高度", renderer.includes("updateNodePresentationFromRatio(node") && renderer.includes("data-lfc-param"));
check("连线使用动态宽高", renderer.includes("const sourceSize=core.nodeSize(source),targetSize=core.nodeSize(target)") && renderer.includes("sourceSize.width") && renderer.includes("targetSize.height/2"));
check("适应画布使用动态边界", renderer.includes("sizes=nodes.map(node=>core.nodeSize(node))") && renderer.includes("sizes[index].width") && renderer.includes("sizes[index].height"));
check("框选使用动态节点尺寸", renderer.includes("const x=Number(node.position?.x)||0,y=Number(node.position?.y)||0,size=core.nodeSize(node)") && renderer.includes("x+size.width") && renderer.includes("y+size.height"));
check("阶段四媒体样式已加载", css.includes(".lfc-node-media-shell") && css.includes(".lfc-node-inline-editor") && css.includes(".lfc-node-content{flex:1"));
check("媒体节点不因状态刷新反复重建", renderer.includes("contentHost.dataset.lfcNodeContentKey!==String(content.key)") && renderer.includes("bindMediaRatio(contentHost,node)"));
check("节点支持手动调整尺寸", renderer.includes("data-lfc-resize-node") && renderer.includes("runtime.nodeResize") && renderer.includes("function cancelNodeResize"));
check("手动尺寸设置用户锁定", renderer.includes("presentation.userResized=true") && css.includes("lfc-node-resize-handle"));
check("媒体支持铺满与完整显示切换", renderer.includes("data-lfc-toggle-fit") && css.includes(".lfc-node.fit-contain"));
check("音频节点提供播放控件", renderer.includes("<audio src=") && css.includes(".lfc-node-audio audio"));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test:"infinite-canvas-phase4-media-display",total:results.length,passed:results.length-failed.length,failed:failed.length,results},null,2));
process.exitCode = failed.length ? 1 : 0;
