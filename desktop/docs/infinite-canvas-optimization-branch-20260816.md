# 无限画布独立优化支线

支线标识：`infinite-canvas-optimization`  
建立日期：2026-08-16  
基线快照：`backups/infinite-canvas-optimization-20260816/baseline/manifest.json`

## 支线目标

在不修改豆包、任务中心、模型网关、授权、浏览器控制器和既有调度器的前提下，优化无限画布模块，并保持画布执行继续进入统一 `window.lingframe.generation.create()`。

## 允许修改的文件白名单

### 画布运行时

- `src/renderer/canvas-flow-core.js`
- `src/renderer/infinite-canvas.js`
- `src/renderer/styles/infinite-canvas.css`
- `src/renderer/styles/canvas-media-v2.css`

### 画布入口

- `src/renderer/index.html`

只允许维护画布 CSS/JS 的资源引用和加载顺序，不改变其他模块入口。

### 画布基线、夹具和测试

- `references/infinite-canvas-ux-ground-truth.json`
- `references/infinite-canvas-media-model-v2-ground-truth.json`
- `references/infinite-canvas-responsive-ground-truth.json`
- `references/infinite-canvas-attached-editor-results-ground-truth.json`
- `references/infinite-canvas-ui-harness.html`
- `references/suspense-10s-canvas-e2e-ground-truth.json`
- `references/suspense-10s-canvas-e2e-result.json`
- `scripts/test-infinite-canvas-ux.cjs`
- `scripts/test-infinite-canvas-media-model-v2.cjs`
- `scripts/test-infinite-canvas-ui.cjs`
- `scripts/test-infinite-canvas-regression.cjs`
- `scripts/test-infinite-canvas-responsive-runtime.cjs`
- `scripts/test-infinite-canvas-doubao-node-cdp.cjs`
- `scripts/test-infinite-canvas-boundary.cjs`
- `scripts/test-suspense-10s-canvas-e2e.cjs`
- `docs/infinite-canvas-ux-v1.md`

## 禁止直接修改的文件

除非先更新支线边界并重新取得确认，否则不得修改：

- `src/main/**`
- `src/preload/**`
- `src/renderer/app.js`
- `src/renderer/app-fixes.js`
- `src/renderer/generation-ui.js`
- `src/renderer/generation-fixes.js`
- `src/renderer/task-center.js`
- `src/renderer/desktop-ui.js`
- `src/renderer/model-gateway.js`
- `src/renderer/project-materials.js`
- `src/main/generation-orchestrator.cjs`
- `src/main/workbench-data-bridge.cjs`
- `src/main/browser-controller.cjs`
- `src/main/embedded-browser-manager.cjs`

画布只能调用既有 API 和事件契约，不通过修改共享调度器来“修好”画布测试。

## 必须保持的功能契约

- DAG 校验、节点类型兼容、重复连接/自连接/循环连接保护；
- 右键新增节点、拖线到空白处新增节点、节点拖动、缩放、平移和面板收起；
- 上游信息传递、拓扑顺序、提示词合并和输入快照；
- 自动保存、历史版本、恢复、撤销、重做、复制、删除；
- 运行当前节点、从当前节点继续、运行整套流程和现场状态显示；
- text/image/video/audio 四类输入节点；
- image/video/audio 三类生成节点；
- 音频 `.mp3` / `audio/mpeg`；
- 32 MB 内联参考素材上限，超过上限必须安全阻止而不是内存溢出；
- 模型参数合并、结果 URL 解析、任务/会话/素材/模型引用回填；
- 画布任务的 `creationSource` 继续为 `infinite-canvas-v2`；
- 画布执行继续通过 `api.generation.create()` 进入统一任务中心。

## 合并保护规则

每次支线合并必须通过以下门禁：

1. 画布核心静态测试：`test-infinite-canvas-ux.cjs`；
2. 媒体模型 V2 测试：`test-infinite-canvas-media-model-v2.cjs`；
3. 画布边界测试：`test-infinite-canvas-boundary.cjs`；
4. 画布 UI 测试：`test-infinite-canvas-ui.cjs`（需要 Playwright）；
5. 响应式运行时测试：`test-infinite-canvas-responsive-runtime.cjs`（需要 Electron/CDP）；
6. 画布豆包节点契约测试：`test-infinite-canvas-doubao-node-cdp.cjs`（只验证画布适配层，不提交真实豆包任务）；
7. 主线回归：`test-infinite-canvas-regression.cjs`；
8. `npm test` 基础冒烟；
9. 构建预览版并用隔离 `userData` 启动；
10. 逐页检查创作首页、素材中心、任务中心、豆包管理、模型网关和系统设置没有加载错误。

任何共享模块测试失败、IPC 通道变化、任务状态变化或模型网关行为变化，都不得自动合并。

## 运行和数据隔离

画布本地存储键保持：

```text
lingframe.infiniteCanvas.v2.<tenantId>.<projectId>
```

预览必须使用独立 `userData`。画布节点不得保存 API Key、Cookie、Browser Profile 路径或服务端绝对地址；节点只保存任务、会话、素材和模型引用。

## 2026-08-16 上游输入净化

画布上游传递已区分“业务输出”和“运行元数据”：提示词只提取输出中的 `content/text/prompt/value/description/summary/result` 等业务字段，不再把 `status`、进度、错误、更新时间、历史结果列表、调试字段等拼入下游输入；素材、任务和会话引用继续通过独立字段传递，右侧上游信息面板仍保留元数据用于追踪。

## 2026-08-16 模式化节点展示

画布节点底层类型和执行契约保持不变，但展示层按画布模式切换：剧情模板保留“故事大纲、分集剧本、导演规划”等明确语义；空白画布改用“文本生成、结构化文本、视觉规划、媒体整理”等通用分类和默认名称。用户手动修改过的节点名称不被覆盖。

## 当前基线结果

- `test-infinite-canvas-ux.cjs`：20/20 通过；
- `test-infinite-canvas-media-model-v2.cjs`：15/15 通过；
- `test-infinite-canvas-boundary.cjs`：12/12 通过；
- `test-infinite-canvas-regression.cjs`：在允许子进程的环境重新运行后 20/20 通过；
- 当前运行环境没有 Playwright，UI 测试暂时标记为环境阻塞；
- 当前开发模式 Electron 二进制不完整，Electron/CDP 测试需要修复依赖或使用已打包预览版。

## 合并后的回归顺序

```text
支线快照
  ↓
画布静态/媒体测试
  ↓
画布 UI/CDP 测试
  ↓
主线回归与语法检查
  ↓
生成预览版
  ↓
隔离 userData 启动
  ↓
跨模块页面冒烟
  ↓
保留旧预览版和支线备份
```

如果任一门禁失败，保留支线现场和测试结果，不覆盖当前主线预览版。
