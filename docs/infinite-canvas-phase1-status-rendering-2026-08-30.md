# 无限画布阶段一：状态与渲染基础

日期：2026-08-30

## 本阶段目标

只处理无限画布模块的状态更新、DOM 渲染隔离、媒体元素复用和视口稳定性，不触碰任务中心、豆包管理、登录、租户、模型网关或浏览器控制模块。

## 已完成

### 1. 任务状态改为局部刷新

- `setNodeState()` 不再因每次状态变化调用完整 `renderCanvasModule()`。
- `awaitTask()` 轮询只更新对应节点、任务行、状态统计和检查器状态。
- `syncCompletedTask()` 与 `generation.onLiveStatus()` 均走局部刷新入口。
- 使用 `requestAnimationFrame` 合并同一帧内的多次状态更新，减少重复布局和绘制。

### 2. 节点 DOM 稳定化

- 节点主体增加稳定的 `data-lfc-node-content-key`。
- 状态文字、状态 class、进度条和错误提示可原地更新。
- 只有输出资产、输入素材或文本内容真正变化时才替换节点主体内容。
- 视频结果不会因为普通轮询反复销毁并重建 `<video>` 元素。
- 局部替换结果内容后重新绑定预览和结果展开操作。

### 3. 运行现场隔离

- 任务行的状态、进度和文字原地刷新。
- 新任务或需要显示完整结果时，只重建运行现场 dock，不重建画布世界和节点 DOM。
- 运行全部按钮和运行现场展开状态单独更新。

### 4. 视口稳定

- 滚轮缩放继续以鼠标位置为中心，不触发完整画布重绘。
- 平移过程中只更新 world transform。
- 缩放和平移保存改为节流，避免高频写入。
- 节点拖动、分组拖动结束后只更新位置、连线、分组边界和检查器，不重建画布。
- 框选结束后不再因隐藏选择框重建画布。

## 验证结果

- `node --check desktop/src/renderer/infinite-canvas.js`：通过。
- `test-infinite-canvas-render-isolation.cjs`：8/8 通过。
- `test-infinite-canvas-execution-envelope.cjs`：15/15 通过。
- `test-infinite-canvas-input-adapter.cjs`：10/10 通过。
- `test-infinite-canvas-media-model-v2.cjs`：15/15 通过。
- `test-infinite-canvas-selection.cjs`：25/25 通过。
- `test-infinite-canvas-ux.cjs`：31/31 通过。
- `test-infinite-canvas-workflow-portability.cjs`：13/13 通过。
- `git diff --check`：通过。

响应式运行测试本次未能连接本地调试页 `lingzhen_ai_desktop @ 9333`，原因是测试页未启动，不属于代码断言失败。

## 本阶段文件

- `desktop/src/renderer/infinite-canvas.js`
- `desktop/scripts/test-infinite-canvas-render-isolation.cjs`

## 未提前处理的内容

节点比例跟随素材、沉浸式画布布局、拖动时编辑器隐藏/恢复、节点整体视觉重做等属于后续阶段，阶段一只提供稳定渲染基础，避免扩大改动范围。
