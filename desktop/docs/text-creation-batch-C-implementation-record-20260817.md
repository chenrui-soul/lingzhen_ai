# 文本创作批次 C 实施记录

执行日期：2026-08-17  
支线：`text-creation-optimization`  
批次：`C`  
状态：功能实现、隔离 Electron 真实交互和回归测试完成；可进入独立预览，尚未使用真实付费模型完成端到端生成验收

## 本批次实现

### AI 动作与上下文

- 提供续写、润色、改写、扩写、精简、转剧本、转分镜和转提示词 8 种动作；
- 支持选中内容、当前段落和全文三种作用范围；
- 提交前固定原项目、原 conversation、原文档、原始范围、原文快照、素材引用、模型、参数和 `clientRequestId`；
- 替换前重新校验原范围内容，正文已经变化时拒绝覆盖。

### 模型与参数

- 右侧增加“模型与参数”折叠面板；
- 支持智能默认、自定义和已保存预设三种模式；
- 只读取模型网关中已启用且确认为文本能力的模型；
- 参数按照模型声明渲染，并执行数值边界、枚举和默认值收敛；
- 预设按租户隔离，支持个人通用和当前项目两种范围；
- 预设过滤 API Key、Token、Cookie、认证头和服务地址等敏感字段。

### 统一任务与原位候选

- 文本生成继续进入统一 `generation.create()`，没有新增文本专用调度器；
- 任务使用 `creationType: "text"`、`creationSource: "text-workspace-ai"` 和 `executionChannel: "model-gateway"`；
- 结果通过任务的 `resultText` 或 `resultAssetId` 恢复，只读取 `workbench.bootstrap()` 和 `assets.readText()`，恢复时不再次提交生成；
- 候选按照 `taskId/resultId/clientRequestId` 合并，重复事件不会产生重复候选；
- 候选只回到原文档右侧候选区，不自动插入、替换或覆盖正文；
- 支持差异预览、插入、替换原范围、创建候选版本和放弃；
- 插入和替换必须再次人工确认。

### conversation 绑定兼容策略

当前主进程在模型网关文本任务携带顶层 `conversationId` 时，会在模型响应返回后直接调用 `updateConversation()` 覆盖正文。批次 C 的主进程属于保护范围，因此本批次没有修改这一公共行为。

为保证“AI 结果先进入候选区”这一红线，提交给 `generation.create()` 的任务暂不携带顶层 `conversationId`；原项目、原 conversation、原文档和请求标识保存在租户隔离的前端执行信封，并在任务返回后写入唯一 `taskId`。真实运行测试已验证后台任务和执行信封一对一绑定，正文不会被模型任务自动覆盖。

后续如果要把 conversation 绑定提升为后台持久字段，应在公共任务协议增加“来源 conversation”和“允许自动回填”两个独立字段，不能重新使用当前会触发自动覆盖的顶层 `conversationId`。

## 文件边界

新增：

- `src/renderer/text-ai-core.js`；
- `src/renderer/text-workspace-ai.js`；
- `src/renderer/styles/text-workspace-ai.css`；
- `references/text-ai-batch-c-ground-truth.json`；
- `scripts/test-text-ai-core.cjs`；
- `scripts/test-text-result-routing.cjs`；
- `scripts/test-text-ai-batch-c-runtime.cjs`。

修改：

- `src/renderer/index.html`：按顺序加载批次 C 样式和适配器；
- `src/renderer/generation-ui.js`：旧文本生成入口在批次 C 接管时让路。

未修改且哈希审计一致：

- `src/main/**`、`src/preload/**`；
- 豆包执行链路；
- 无限画布和 DAG；
- 任务中心、任务坞后台；
- 模型网关公共模块；
- `app.js`、`app-fixes.js`。

## 测试结果

- AI 核心契约：11/11；
- 结果路由和边界：11/11；
- 批次 C 隔离 Electron 真实交互：12/12；
- 素材中心共享契约：11/11；
- 文本 UI 修复静态回归：6/6；
- 文本素材库：13/13；
- 三栏布局：9/9；
- 文本工作区：21/21；
- 响应式 Electron 运行测试：6/6；
- 新建、预览缩放、侧栏和素材按钮 Electron 运行测试：8/8；
- 项目基础回归：17/17；
- 合计：125/125 通过；
- `text-ai-core.js`、`text-workspace-ai.js`、`generation-ui.js` 和运行测试脚本语法检查通过；
- 10 个保护文件 SHA-256 与实施前快照完全一致。

真实交互测试还验证了：

- 点击“确认提交”会创建真实统一任务；
- 测试任务与原文档执行信封一对一绑定；
- 已完成结果只恢复一个候选；
- 人工确认前正文不变化；
- 替换后刷新页面仍幂等恢复；
- 测试使用不可达的隔离测试厂商，没有调用真实付费模型。

## 快照与后续

实施前快照：

`backups/text-creation-optimization-20260816/batch-C-preimplementation-20260817-033220/`

实施后测试快照：

`backups/text-creation-optimization-20260816/batch-C-posttest-20260817-040850/`

“创建版本”当前保存为候选分支版本，不自动写入或覆盖正文历史。批次 D（资料研究与上下文整理）、批次 E（专业模板与结构化创作）和批次 F（检查、导出与体验完善）尚未实施。
