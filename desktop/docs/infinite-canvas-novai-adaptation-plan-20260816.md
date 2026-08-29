# 无限画布 NOVAI 思想适配实施方案

日期：2026-08-16  
支线：`infinite-canvas-optimization`  
原则：保留灵帧现有独立画布架构，只参考公开的交互和数据流思想，自行实现，不复制 NOVAI 源码。

## 1. 目标

本方案解决以下问题：

1. 上游业务内容、素材引用、控制信号和运行元数据明确分离；
2. 上游输入顺序、启停状态、角色说明和来源证据可配置、可保存、可恢复；
3. 剧情模式与自定义空白模式使用不同的分类和默认名称，但底层节点类型不变；
4. 当前节点和整套流程执行继续统一进入 `generation.create()`；
5. 任务、会话、素材、模型、账号、结果和画布节点保持可追踪绑定；
6. `submission_unknown`、登录验证、额度锁和结果恢复继续由现有调度器处理；
7. 支线可以独立开发、测试、预览和回滚，不影响豆包、任务中心、模型网关和既有调度器。

## 2. 明确不做

- 不复制 NOVAI 的 `canvas.js`、`smart-canvas.js` 或后端路由代码；
- 不引入 NOVAI 的商业受限源码或资源；
- 不新增画布专用图片、视频、LLM 或 ComfyUI 生成接口；
- 不在画布内实现豆包登录、验证码、账号并发、额度锁或任务轮询规则；
- 不直接调用任务中心写接口、豆包窗口控制接口或模型网关写接口；
- 不把运行状态、错误、历史结果对象或完整 JSON 自动拼入模型提示词；
- 不用结果 URL 代替素材、任务、会话和节点的正式标识。

## 3. 目标架构

```text
节点/连线编辑器
    ↓
画布输入适配层
    ├─ 文本业务输出
    ├─ 有序素材引用
    ├─ 角色与用途说明
    ├─ 控制信号
    └─ 只读追踪元数据
    ↓
执行信封 Execution Envelope
    ↓
generation.create()
    ↓
现有任务中心与调度器
    ├─ 豆包账号串行/跨账号并行
    ├─ 登录和验证码恢复
    ├─ submission_unknown 保护
    ├─ 额度锁与重置等待
    ├─ 模型网关
    └─ 下载与结果恢复
    ↓
画布结果回填适配层
    ├─ taskId
    ├─ conversationId
    ├─ assetId
    ├─ resultUrl
    ├─ accountId
    └─ providerId/modelId
```

画布负责“怎么编排”，现有调度器负责“怎么真实执行”。

## 4. 输入适配层设计

### 4.1 新增纯前端适配模块

建议新增：

```text
src/renderer/canvas-input-adapter.js
```

职责仅包括：

- 按拓扑和显式顺序收集上游；
- 从不同节点类型提取业务文本；
- 从输出和引用中提取素材 ID；
- 生成可追踪的输入清单；
- 过滤运行元数据；
- 校验目标节点能够接收的输入类型；
- 不调用任何 Electron、IPC、任务或模型接口。

建议导出：

```js
resolveExecutionEnvelope(nodeId, nodes, edges)
extractBusinessText(node)
extractAssetBindings(node)
orderInputBindings(targetNode, edges, sourceItems)
validateInputEnvelope(targetNode, envelope)
```

### 4.2 执行信封

```js
{
  nodeId,
  kind,
  title,
  instruction,
  prompt,
  assetIds,
  inputManifest: [
    {
      bindingId,
      sourceNodeId,
      sourceKind,
      outputType,
      order,
      enabled,
      role,
      assetId,
      contentPreview,
      evidence
    }
  ],
  upstream: {
    businessItems: [],
    metadataItems: []
  },
  modelParameters
}
```

其中：

- `prompt` 只包含允许发送给模型的业务文本；
- `assetIds` 保持用户配置后的稳定顺序；
- `inputManifest` 用于画布追踪、预览和恢复，不直接拼入 prompt；
- `metadataItems` 仅用于右侧信息面板；
- `evidence` 只保存节点、素材、任务和输出引用，不保存 Cookie、密钥或浏览器路径。

### 4.3 允许进入 prompt 的字段

默认白名单：

```text
content
text
prompt
value
description
summary
result 中的业务文本
```

默认禁止：

```text
status
progress
runError
updatedAt
startedAt
completedAt
results
activeResultId
lastInputFingerprint
debug
raw
provider response
完整结构化 JSON
```

### 4.4 文本与素材不重复传递

- 文本内容进入 `prompt`；
- 素材通过 `assetIds` 进入任务；
- 素材名称、URL、MIME 和本地路径不自动进入 prompt；
- 必要的角色说明以用户可见的短文本进入 prompt；
- 素材证据保留在 `inputManifest`。

## 5. 输入顺序与角色绑定

### 5.1 连线扩展

在保持现有 `source/target` 兼容的前提下，为画布连线增加可选数据：

```js
edge.data = {
  enabled: true,
  order: 10,
  transferMode: "auto",
  role: "",
  label: ""
};
```

字段含义：

- `enabled`：临时停用传递但不删除连线；
- `order`：决定同一目标节点的输入顺序；
- `transferMode`：`auto/text/asset/control`；
- `role`：人物、场景、道具、服装、姿势、风格、首帧、尾帧等；
- `label`：用户自定义说明。

### 5.2 排序规则

```text
显式 edge.data.order
  ↓
连线创建顺序
  ↓
源节点内部素材顺序
  ↓
assetIds 原始顺序
```

禁止通过 Set 排序后破坏原始上传顺序。去重必须保留第一次出现的位置。

### 5.3 输入管理界面

在节点编辑器中增加“上游输入”区域：

- 拖动调整顺序；
- 启用/停用某个输入；
- 设置传递方式；
- 设置素材角色；
- 查看来源节点、素材、任务和结果；
- 预览最终将发送的文本与素材清单；
- 运行前显示数量和类型不兼容提示。

不把这些配置字段显示在主提示词输入框中。

## 6. 节点模式化展示

继续使用已建立的模式展示层：

- 剧情模式：故事大纲、分集剧本、导演规划、分镜表等；
- 空白模式：文本生成、结构化文本、视觉规划、媒体整理等；
- 底层 `kind`、输入输出类型和执行契约不变；
- 用户手动改名后不自动覆盖；
- 节点库、右键菜单、属性面板、任务标题和会话标题保持一致。

后续不得通过复制节点类型来实现两套模式，避免执行器分裂。

## 7. 流程调度适配

### 7.1 可借鉴思想

自行实现以下能力：

- 找到当前节点的全部必要上游；
- 拓扑排序；
- 循环检测；
- 当前节点执行；
- 从当前节点继续；
- 整套流程执行；
- 已完成且输入未变化的节点可跳过；
- 输入变化后标记下游结果过期；
- 失败后停止，并保留失败节点位置。

### 7.2 不在画布实现的能力

以下继续完全交给现有调度器：

- 豆包同账号串行；
- 不同账号并行；
- 登录和验证码恢复；
- 原窗口和原 conversation 继续观察；
- `submission_unknown` 不自动重提；
- 账号锁和额度锁；
- Asia/Shanghai 重置日期；
- 生成结果下载与恢复；
- 服务繁忙、额度耗尽等任务级重试策略。

### 7.3 唯一真实执行入口

```js
api.generation.create({
  title,
  prompt: envelope.prompt,
  assetIds: envelope.assetIds,
  projectId,
  creationType,
  creationSource: "infinite-canvas-v2",
  executionChannel,
  providerId,
  modelId,
  accountGroupId,
  accountSelectionMode,
  accountCandidates,
  accountId,
  conversationId,
  modelParameters,
  ratio,
  duration,
  resolution,
  generationMode,
  canvasId,
  canvasNodeId
});
```

若未来需要把完整 `inputManifest` 写入任务中心，必须另开共享契约变更，由任务中心和调度器支线共同评审；本支线第一阶段不修改共享接口。

## 8. 结果回填与恢复

节点当前输出统一保存：

```js
{
  type,
  content,
  assetId,
  assetName,
  resultUrl,
  taskId,
  accountId,
  conversationId,
  providerId,
  modelId,
  completedAt
}
```

规则：

1. `assetId` 是素材传递的首选标识；
2. `taskId` 是结果状态和恢复的首选标识；
3. `resultUrl` 只作为结果位置，不作为任务身份；
4. 历史结果保留独立记录，不自动进入下游 prompt；
5. 用户切换当前结果时只切换引用，不重新生成；
6. 结果恢复只能调用既有恢复/下载能力；
7. `submission_unknown` 节点保持暂停，不释放为可自动复用状态；
8. 下游只使用明确选择的当前结果或绑定的素材结果。

## 9. 工作流导入导出

第二阶段后再实施，格式使用灵帧自有 schema：

```json
{
  "format": "lingframe-infinite-canvas-workflow",
  "schemaVersion": 4,
  "mode": "blank",
  "nodes": [],
  "edges": [],
  "assetBindings": [],
  "metadata": {}
}
```

导出规则：

- 只导出选中节点和内部连线；
- 不导出 API Key、Cookie、账号 Profile 或绝对路径；
- 可导出素材引用清单，但不默认复制原始媒体；
- 任务 ID、conversation ID 和账号 ID 默认标记为环境引用。

导入规则：

- 重建节点和连线 ID；
- 素材按 assetId、文件指纹或用户选择重新绑定；
- 账号、模型、任务和 conversation 不直接跨租户复用；
- 找不到素材时标记“待重新绑定”，不自动触发生成；
- 导入后先通过 DAG 和类型校验，未通过不得运行。

## 10. 开发批次

### 批次 A：输入适配核心

修改或新增：

```text
src/renderer/canvas-flow-core.js
src/renderer/canvas-input-adapter.js
src/renderer/index.html
scripts/test-infinite-canvas-input-adapter.cjs
references/infinite-canvas-input-adapter-ground-truth.json
```

交付：

- 文本、素材、控制、元数据分离；
- 有序去重；
- 类型适配；
- 污染字段过滤；
- 不改变真实执行接口。

### 批次 B：输入顺序和角色 UI

修改：

```text
src/renderer/infinite-canvas.js
src/renderer/styles/infinite-canvas.css
src/renderer/styles/canvas-media-v2.css
scripts/test-infinite-canvas-ui.cjs
```

交付：

- 上游输入面板；
- 拖动排序；
- 启用/停用；
- 角色选择；
- 最终执行输入预览；
- 自动保存与撤销/重做覆盖新增字段。

### 批次 C：执行信封接入

修改：

```text
src/renderer/infinite-canvas.js
scripts/test-infinite-canvas-execution-envelope.cjs
scripts/test-infinite-canvas-boundary.cjs
```

交付：

- 当前节点和整套流程都使用同一信封；
- 只调用 `api.generation.create()`；
- `canvasId/canvasNodeId` 保持；
- 结果回填和输入指纹使用同一份执行信封。

### 批次 D：结果和恢复约束

修改：

```text
src/renderer/infinite-canvas.js
scripts/test-infinite-canvas-result-recovery.cjs
references/infinite-canvas-result-recovery-ground-truth.json
```

交付：

- 当前结果、历史结果和上游传递结果分离；
- 恢复不重新生成；
- `submission_unknown` 不触发新的 `generation.create()`；
- 任务、素材、会话和账号引用保持一致。

### 批次 E：工作流导入导出

修改或新增：

```text
src/renderer/canvas-workflow-portability.js
src/renderer/infinite-canvas.js
scripts/test-infinite-canvas-workflow-portability.cjs
```

交付：

- 选中流程导出；
- ID 重映射；
- 素材重新绑定；
- 租户边界保护；
- 缺失素材不自动生成。

### 批次 F：预览与合并

执行：

- 全部画布静态测试；
- UI/Playwright；
- Electron/CDP；
- 主线综合回归；
- 隔离 userData 构建预览；
- 跨模块冒烟；
- 保存支线快照和日志后再合并。

## 11. 测试矩阵

### 输入净化

- 输出中有 `content` 和 `status/debug/raw/results`，只传 `content`；
- 输出为结构化对象时只提取业务白名单；
- 素材名称、URL、路径不进入 prompt；
- 历史结果说明不进入 prompt；
- 未执行的文本输入节点仍能传递用户正文；
- 未执行的生成节点不得把历史运行错误当正文。

### 顺序与角色

- 拖动顺序保存后刷新不变化；
- 撤销/重做恢复顺序；
- 首帧始终先于尾帧；
- 同一素材重复连接只保留第一次有效出现；
- 人物、场景、道具、服装、姿势、风格角色保存；
- 停用输入后不进入 prompt 和 assetIds，但仍保留连线。

### DAG 与类型

- 禁止自连接；
- 禁止重复连接；
- 禁止形成循环；
- 图片不能误传为音频；
- 视频、音频、图片、文本输入按目标节点能力筛选；
- 输出节点允许汇总多类型结果。

### 统一执行

- 当前节点只创建一个统一任务；
- 整套流程每个需要执行的节点各创建一次任务；
- 已完成且输入未变化节点跳过；
- 输入变化后只使受影响下游过期；
- 不出现画布专用生成接口；
- `creationSource`、`canvasId`、`canvasNodeId` 完整。

### 状态保护

- `submission_unknown` 不自动重提；
- 登录/验证码状态不新建任务；
- 额度等待状态不绕过调度器；
- 下载失败只进入恢复逻辑；
- 结果恢复不调用 `generation.create()`；
- 失败分类原样展示，不在画布重新分类覆盖。

### 边界回归

- 豆包模块无变更；
- 任务中心无变更；
- 模型网关无变更；
- 主进程和 preload 无变更；
- 创作首页、素材中心、任务中心、豆包管理、模型网关可正常使用。

## 12. 合并门禁

必须全部满足：

```text
test-infinite-canvas-ux.cjs
test-infinite-canvas-input-adapter.cjs
test-infinite-canvas-media-model-v2.cjs
test-infinite-canvas-execution-envelope.cjs
test-infinite-canvas-result-recovery.cjs
test-infinite-canvas-boundary.cjs
test-infinite-canvas-regression.cjs
npm test
UI/Playwright
Electron/CDP
隔离 userData 预览
```

以下任一情况不得自动合并：

- 新增画布专用生成 API；
- 修改 `src/main/**` 或 `src/preload/**`；
- 画布直接调用豆包窗口或模型网关写接口；
- `submission_unknown` 触发重提；
- 输入顺序在刷新后变化；
- 结果恢复创建新任务；
- 主线模块测试失败；
- 无法证明新增实现未复制受限源码。

## 13. 回滚方案

每个批次开始前保存：

```text
backups/infinite-canvas-optimization-20260816/batch-<name>-before/
```

每个批次完成后保存：

```text
backups/infinite-canvas-optimization-20260816/batch-<name>-passed/
```

回滚只恢复本批次允许修改的画布文件，不覆盖用户数据、不删除现有画布存储、不修改其他模块。

数据迁移要求：

- 新字段均为可选；
- 旧连线没有 `data` 时自动补默认值；
- 旧节点没有输入顺序时按当前稳定顺序生成；
- 迁移必须幂等；
- 旧版本仍能读取基础 `source/target`；
- 迁移失败时保留原文档并阻止自动保存覆盖。

## 14. 完成定义

方案完成不是“界面能显示”，而是同时达到：

1. 输入框没有运行元数据污染；
2. 上游输入顺序和角色可编辑、可保存、可恢复；
3. 剧情和空白模式名称一致且不混乱；
4. DAG、类型和循环保护通过；
5. 所有真实生成仍走 `generation.create()`；
6. 结果恢复不重新生成；
7. `submission_unknown` 不自动重提；
8. 任务、素材、会话、账号和节点可追踪；
9. 主线模块无回归；
10. 预览版完成真实点击和真实任务链路验证。

## 15. 推荐执行顺序

```text
批次 A 输入适配核心
  ↓
批次 B 输入顺序和角色 UI
  ↓
批次 C generation.create 执行信封
  ↓
批次 D 结果与恢复保护
  ↓
批次 E 工作流导入导出
  ↓
批次 F 隔离预览、主线回归和合并
```

第一轮应先执行批次 A，不同时改 UI 和任务调用；输入适配层测试稳定后再进入批次 B。

## 批次 A 实施记录（2026-08-16）

已完成：

- 新增 `src/renderer/canvas-input-adapter.js`；
- 页面按 `canvas-flow-core.js → canvas-input-adapter.js → infinite-canvas.js` 顺序加载；
- `canvas-flow-core.js` 的 `resolveNodeExecutionInput()` 在浏览器运行时接入输入适配层；
- 新增 `scripts/test-infinite-canvas-input-adapter.cjs`；
- 输入适配层支持业务文本净化、素材顺序、素材角色、停用输入、任务追踪和输入证据；
- 未改变 `src/main/**`、`src/preload/**`、任务中心、豆包或模型网关。

当前批次验收：

- 输入适配层：10/10；
- 无限画布 UX：25/25；
- 媒体模型 V2：15/15；
- 画布边界：13/13；
- 主线回归：20/20；
- 基础冒烟：17/17。

下一步进入批次 B：输入顺序和角色 UI。批次 B 在没有 UI 测试通过前，不接入真实任务新增字段。

## 批次 B 实施记录（2026-08-16）

已完成：

- 节点“数据”面板新增输入绑定区；
- 支持上游绑定上移、下移；
- 支持启用/停用某条上游输入；
- 支持自动、仅文本、仅素材、控制四种传递方式；
- 支持人物、场景、道具、服装、姿势、风格、首帧、尾帧等角色说明；
- 支持本地素材角色保存，并保持本地素材原始顺序；
- 输入配置修改进入撤销/重做快照和自动保存；
- 右侧仍同时显示最终执行输入预览和上游元数据。

当前批次验收：

- 输入绑定 UI 静态契约：8/8；
- 输入适配层：10/10；
- 无限画布 UX：25/25；
- 画布边界：13/13；
- `infinite-canvas.js` 语法检查通过。

尚未完成：当前环境缺少 Playwright，真实浏览器拖动排序和点击交互需在可用的 UI/CDP 预览环境中继续验证。

## 批次 C 实施记录（2026-08-16）

已完成：

- 在画布唯一执行点新增 `buildGenerationEnvelope()`；
- 当前节点执行和整套流程执行均复用 `executeNode()` 与同一执行信封；
- 信封统一携带 `prompt`、`assetIds`、`referenceAssets`、`inputManifest`、`modelParameters`、`conversationId`、`canvasId` 和 `canvasNodeId`；
- 输入证据保留在画布节点的 `executionEnvelope` 快照中，运行元数据不拼入 `prompt`；
- 参考素材角色从画布中文角色适配为统一任务契约角色，上传/绑定顺序保留；
- 仍只调用 `api.generation.create(request)`，没有新增任务中心、豆包窗口或模型网关直写接口；
- 新增 `scripts/test-infinite-canvas-execution-envelope.cjs`。

当前批次验收：

- 执行信封契约：10/10；
- 输入适配层：10/10；
- 输入绑定 UI：8/8；
- 画布边界：13/13；
- `infinite-canvas.js` 语法检查通过。

说明：`canvasId`、`canvasNodeId` 和 `inputManifest` 会随请求传入统一入口；现有任务公共契约对未知字段不持久化，因此输入证据的可靠本地副本保存在节点执行快照中。若后续要求任务中心跨模块查询这些字段，应另开共享契约变更批次，不在本批次越界修改主进程或调度器。

## 批次 D 实施记录（2026-08-16）

已完成：

- 结果回填前新增任务、项目、画布、节点、会话、账号绑定校验；
- 结果素材必须存在、未删除且属于当前画布项目；
- 文本结果必须从原 `conversationId` 恢复，禁止以新会话替代；
- 结果输出明确标记 `recoveryMode: "download-only"`；
- 任务完成后的同步会按已有 `taskId` 从节点引用恢复绑定，不依赖仅存在于内存的映射；
- `submission_unknown` 继续保持暂停，不触发重提，也不释放账号；
- 结果同步、结果恢复保护路径没有新增 `generation.create()` 调用；
- 新增 `scripts/test-infinite-canvas-result-recovery.cjs`。

当前批次验收：

- 结果与恢复保护：12/12；
- 执行信封：10/10；
- 画布边界：13/13；
- 主线回归：20/20；
- 基础 `npm test`：17/17；
- `infinite-canvas.js` 语法检查通过。

说明：本批次仍只修改画布渲染侧和测试/文档；实际结果下载、素材唯一归属和任务状态写入继续由既有任务中心、结果回填链路和调度器负责。

## 批次 E 实施记录（2026-08-16）

已完成：

- 新增 `src/renderer/canvas-workflow-portability.js`，使用灵帧自有工作流格式 `lingframe-infinite-canvas-workflow`，schemaVersion 4；
- 支持导出当前选中节点及内部连线；未选择节点时导出整套当前画布；
- 导出时重映射节点/连线 ID，清除运行结果、taskId、conversationId 和执行快照；
- 账号、模型、任务、conversation 作为环境引用记录，不跨租户直接复用；
- 不导出 API Key、Cookie、密码、Profile 或绝对路径；
- 支持通过浏览器文件下载/选择完成工作流导出导入；
- 导入时重建本地节点/连线 ID，执行 DAG、节点类型和连线兼容性校验；
- 素材按当前项目可用 `assetId` 尝试绑定，缺失素材标记 `pendingAssetBindings`，不自动生成；
- 增加显式租户边界校验；
- 画布入口加载顺序保持 `canvas-flow-core.js → canvas-input-adapter.js → canvas-workflow-portability.js → infinite-canvas.js`；
- 新增 `scripts/test-infinite-canvas-workflow-portability.cjs`。

当前批次验收：

- 工作流导入导出：13/13；
- 画布边界：13/13；
- 无限画布 UX：25/25；
- 主线回归：20/20；
- 基础 `npm test`：17/17；
- `infinite-canvas.js` 与可移植模块语法检查通过。

说明：导入导出只处理工作流结构与引用清单，不复制原始媒体文件；导入后的缺失素材必须由用户重新绑定后才能形成完整可执行输入。

## 批次 F 实施记录（2026-08-16）

已完成：

- 创建批次 F 前快照：`backups/infinite-canvas-optimization-20260816/batch-F-before/`；
- 创建批次 F 通过快照：`backups/infinite-canvas-optimization-20260816/batch-F-passed/`；
- 完成输入适配、输入绑定、执行信封、结果恢复、工作流导入导出、边界、媒体模型 V2、UX 和主线回归；
- 完成豆包失败分类、提交证据、统一执行和基础冒烟回归；
- `npm run preflight:dist:internal-http` 通过；
- 使用 Electron 31 启动隔离 userData 预览实例，CDP 页面加载检查通过；
- 未修改 `src/main/**`、`src/preload/**`、任务中心、豆包调度器和模型网关；
- 当前画布支线变更已进入共享工作区主线代码，未发生跨模块覆盖。

回归结果：

- 输入适配：10/10；
- 输入绑定 UI：8/8；
- 执行信封：10/10；
- 结果与恢复：12/12；
- 工作流导入导出：13/13；
- 画布边界：13/13；
- 媒体模型 V2：15/15；
- 无限画布 UX：25/25；
- 画布主线回归：20/20；
- 豆包失败结果：18/18；
- 提交证据：20/20；
- 统一执行：7/7；
- 基础 `npm test`：17/17；
- 隔离 Electron 预览启动：5/5；
- 内测构建预检：通过。

环境限制：

- Playwright 未安装，因此 `test-infinite-canvas-ui.cjs` 未执行；
- 未发现可复用的 9333 CDP 实例，因此 `test-infinite-canvas-responsive-runtime.cjs` 未执行；
- 已用独立 Electron/CDP 启动检查替代，真实拖拽、文件选择和多视口交互仍需在安装 Playwright 或连接可用 CDP 的环境中完成。

## 交互补充：节点框选与连线删除（2026-08-16）

- 空白画布左键拖拽支持矩形框选节点；按 Ctrl/Cmd/Shift 拖拽可追加选择；中键拖拽保留画布平移；
- 连线可点击选中，Delete/Backspace 删除选中连线；
- 删除连线只解除两个节点之间的输入绑定，不删除节点、不取消已创建或已执行任务；
- 删除操作进入撤销/重做和自动保存；
- 新增 `scripts/test-infinite-canvas-selection.cjs`，专项契约 10/10 通过。
