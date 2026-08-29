# 灵帧AI桌面版无限画布 UX V1

## 合并边界

本实现只增加无限画布独立模块，不修改豆包管理、账号分组、任务中心、模型网关、素材中心和现有生成调度器。

画布真实执行通过已有 `window.lingframe.generation.create()` 进入统一任务中心：

- 同一个豆包账号继续由主调度器串行排队。
- 不同豆包账号和模型网关任务继续支持并行。
- `submission_unknown` 不自动重提。
- 豆包验证保持人工处理。

## 新增文件

- `src/renderer/canvas-flow-core.js`：DAG 校验、类型兼容、上游数据汇总、拓扑排序和短剧模板。
- `src/renderer/infinite-canvas.js`：桌面画布 UI、交互、保存、运行和任务同步。
- `src/renderer/styles/infinite-canvas.css`：科技感主题、节点、面板和响应式规则。
- `references/infinite-canvas-ux-ground-truth.json`：测试 Ground Truth。
- `references/infinite-canvas-ui-harness.html`：画布独立浏览器测试壳。
- `scripts/test-infinite-canvas-ux.cjs`：核心数据流测试。
- `scripts/test-infinite-canvas-ui.cjs`：多尺寸交互测试。
- `scripts/test-infinite-canvas-regression.cjs`：主线模块回归集合。

## 主文件挂载

`src/renderer/index.html` 只新增三处资源：

1. `./styles/infinite-canvas.css`
2. `./canvas-flow-core.js`，放在 `app.js` 之前
3. `./infinite-canvas.js`，放在其他桌面增强模块之后

如果主线的 `index.html` 已继续修改，建议只手动合并这三行，不要整文件覆盖。

## 数据隔离

画布当前使用租户和项目共同组成的桌面本地存储键：

`lingframe.infiniteCanvas.v2.<tenantId>.<projectId>`

节点不会存储 API Key、Cookie、浏览器 Profile 路径或服务器绝对路径。任务执行结果在节点中只保存任务、会话、素材和模型引用。

## 交互能力

- 节点库搜索、拖放和双击新增
- 画布空白处右键新增
- 从端口拉线到空白处新增并自动连接
- 自连接、重复连接、类型不兼容和循环依赖保护
- 节点拖动、画布平移、缩放、适应、缩略图
- 左侧节点库和右侧属性面板收起
- 属性、数据、运行、版本四个检查面板
- 上游数据、输入快照、输出快照和隔离绑定可视化
- 自动保存、手动版本、恢复版本、撤销、重做、复制和删除
- 运行当前节点、从当前节点继续、运行整套流程
- 任务现场、人工确认、豆包验证和提交状态未知提示

## 回退

删除新增的三个画布资源文件，并从 `index.html` 移除三处资源引用即可回退；其他模块不需要恢复。

## 验收命令

```powershell
node scripts/test-infinite-canvas-ux.cjs
node scripts/test-infinite-canvas-ui.cjs
node scripts/test-infinite-canvas-regression.cjs
```

浏览器 UI 测试需要 Playwright。Codex 工作区可通过 `NODE_PATH` 指向内置 Node 依赖目录运行。
