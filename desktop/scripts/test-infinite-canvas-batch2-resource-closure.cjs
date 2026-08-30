"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const renderer = fs.readFileSync(path.join(root, "src/renderer/infinite-canvas.js"), "utf8");
const css = fs.readFileSync(path.join(root, "src/renderer/styles/infinite-canvas.css"), "utf8");
const plan = fs.readFileSync(path.join(root, "..", "docs", "infinite-canvas-ui-revision-plan-2026-08-30.md"), "utf8");
const results = [];
const check = (name, passed, detail = "") => results.push({name, passed: Boolean(passed), detail: passed ? "" : detail});

check("每张画布创建独立 assetScope", renderer.includes("assetScope:emptyAssetScope()") && renderer.includes("function assetScope(canvas=currentCanvas())"));
check("旧画布迁移会扫描节点引用和生成结果", renderer.includes("normalizeAssetScope(canvas,canvas.assetScope)") && renderer.includes("canvasReferencedAssets(canvas)"));
check("当前画布资产与其它资产分离", renderer.includes('mode==="project-assets"?canvasAssets([],currentCanvas(),true):all.filter(asset=>!scoped.has(String(asset.id)))'));
check("资源面板展示来源画布和共享资产", renderer.includes("assetOriginLabel") && renderer.includes("来自其它画布") && renderer.includes("共享项目资产"));
check("本地上传进入 localAssetIds", renderer.includes('addAssetToScope(id,"local",{sourceKind:"local-upload"})') && renderer.includes('addAssetToScope(asset.id,"local",{sourceKind:"local-upload"})'));
check("节点引用进入 importedAssetIds", renderer.includes('addAssetToScope(id,"imported",{sourceKind:"node-reference"})'));
check("跨项目添加先复制再归入当前画布", renderer.includes("api.assets.copy") && renderer.includes("cross-project-copy") && renderer.includes("openCrossProjectPicker"));
check("生成结果归入 generatedAssetIds", renderer.includes('addAssetToScope(output.assetId,"generated",{sourceKind:"generated-result"'));
check("首屏创建的新画布归档参考素材", renderer.includes('sourceKind:"creator-reference"') && renderer.includes("canvas.creatorDraft=normalizeCreatorDraft(draft)"));
check("当前画布支持别名角色标签排序编辑", renderer.includes("data-lfc-asset-alias") && renderer.includes("data-lfc-asset-role") && renderer.includes("data-lfc-asset-scope-tags") && renderer.includes("data-lfc-asset-order"));
check("当前画布移除只移除引用不删除原始素材", renderer.includes("scope.removedAssetIds=uniqueIds([...scope.removedAssetIds,id])") && renderer.includes("原始资产仍保留"));
check("当前画布素材支持恢复", renderer.includes("data-lfc-resource-restore") && renderer.includes("素材已恢复到当前画布"));
check("原始项目资产支持更新、软删除和恢复", renderer.includes("api.assets.update") && renderer.includes("api.assets.delete") && renderer.includes("api.assets.restore") && renderer.includes("移入回收站"));
check("文本读取失败有可见状态和重试入口", renderer.includes("readError") && renderer.includes("showPreviewError") && renderer.includes("retryAssetPreview"));
check("媒体加载失败有局部重试入口", renderer.includes("bindAssetMediaErrors") && renderer.includes("lfc-inline-retry") && css.includes(".lfc-inline-retry"));
check("导入和生成不把文本文件当作文本输入", renderer.includes("api.assets.readText") && renderer.includes("parts.push"));
check("资源预览错误不会静默吞掉", renderer.includes("runtime.previewError=String(error.message||error)") && renderer.includes("素材加载失败"));
check("资源编辑器限定在无限画布并使用软删除语义", renderer.includes("function openAssetEditor") && renderer.includes("已提交任务不会被取消"));
check("跨项目选择后复制并添加", renderer.includes("function renderCrossProjectPicker") && renderer.includes("复制并添加到画布"));
check("第 2 批仍限定无限画布范围", plan.includes("第 2 批：资源闭环") && plan.includes("不修改登录、租户、管理中心、任务中心"));

const failed = results.filter(item => !item.passed);
console.log(JSON.stringify({test:"infinite-canvas-batch2-resource-closure",total:results.length,passed:results.length-failed.length,failed:failed.length,results}, null, 2));
process.exitCode = failed.length ? 1 : 0;
