# 豆包专项运维优化支线：只读审计与调用链追踪

审计日期：2026-08-16（Asia/Shanghai）  
阶段：只读审计，未修改产品代码。  
范围：账号登录、独立窗口、任务调度、参考素材、参数、提交识别、人工验证、监控、结果回传、失败分类、额度锁和恢复重试。

## 1. 调用链总览

```text
Renderer
  创作首页 / 任务中心 / 无限画布
      │ window.lingframe.generation.create/run/resume/monitor
      ▼
preload.cjs
      │ ipcRenderer.invoke
      ▼
main.cjs
  generation:create/run/resume/monitor/cancel
      ▼
GenerationOrchestrator
  create → run → runDoubaoWithFailover
      ├─ selectDoubaoAccount
      ├─ acquireAccount / holdAccount
      ├─ EmbeddedBrowserManager.beginTask
      ├─ AgentBridge.browser.execute
      │    ▼
      │  BrowserController.execute
      │    ├─ open(account)
      │    ├─ detect(login)
      │    ├─ prepareFreshConversation
      │    ├─ ensureVideoMode
      │    ├─ setVideoParameters
      │    ├─ uploadReferenceImages
      │    ├─ fillComposer
      │    ├─ clickComposerSend
      │    ├─ readSubmissionState / classifySubmissionEvidence
      │    ├─ resume 原 conversation
      │    ├─ waitForVideo
      │    └─ VideoDownloader.download
      └─ WorkbenchDataBridge.report/complete/import/额度锁
```

## 2. 账号和窗口链路

### 2.1 账号隔离

`EmbeddedBrowserManager.partitionFor()` 使用：

```text
persist:lingframe_<tenantId>_doubao_<accountId>
```

每个账号第一次打开时创建独立 `BrowserWindow`，并写入：

```text
<tenantRoot>/embedded-browser-profiles/<accountId>/partition.txt
```

窗口使用 `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`backgroundThrottling: false`。不同账号维护不同 `webContents` 和 Cookie/Storage 分区。

### 2.2 悬浮窗口和关闭保护

- 窗口固定安全尺寸：1280×860，最小 1080×720。
- `beginTask()` 把 taskId 放入 `activeTaskIds`，窗口显示并闪烁提醒。
- 任务运行期间点击关闭按钮会被拦截，窗口隐藏而不是销毁。
- 任务进入 `completed/failed/cancelled` 后移除 taskId；没有其他活动任务时自动隐藏。
- `activateAccount()`、`hideAccount()`、`openPopout()` 支持从任务坞或豆包管理页重新聚焦现场。

这部分满足“一个账号一个窗口/分区”和“运行中关闭只隐藏”的保护基线。

## 3. 任务创建和调度链路

### 3.1 任务创建

`GenerationOrchestrator.create()`：

1. 要求执行通道为 `doubao` 或 `model-gateway`；
2. 豆包通道必须提供账号或账号候选池；
3. 把租户身份写入任务；
4. 初始状态设为 `queued`；
5. 立即调用 `run(task.id)`，异步进入调度。

首页和无限画布都会带上：

- `accountSelectionMode`
- `accountCandidates`
- `accountId/accountName`
- `doubaoModel`
- `ratio`
- `duration`
- `assetIds/referenceAssets`
- `projectId/conversationId`

### 3.2 同账号串行

`accountKey()` 使用：

```text
doubao:<tenantId>:<accountId>
```

`accountQueues`、`accountOwners` 和 `accountLeases` 共同实现账号级队列：

- 同账号第二个任务进入 `queued`；
- 前一任务释放 lease 后才获得账号；
- 取消、完成、终止失败、额度切换等路径调用 `releaseAccount()`。

### 3.3 不同账号并行的现状风险

`BrowserController` 另外维护了一个全局 `submissionTail`，`execute({action:"generate"})` 会通过 `withSubmissionLock()` 包裹整个 `runGeneration()`。

这意味着：

- 不同账号虽然通过 `GenerationOrchestrator.accountKey()` 不共享账号锁；
- 但初次生成仍共享全局提交锁；
- 锁覆盖登录检测、模式设置、参考图上传、提示词填入和最长 30 秒的提交证据等待；
- 因此不同账号的初次提交可能被整体串行化。

现有 `scripts/test-submission-lifecycle.cjs` 还把这一行为作为“多账号页面配置与提交互斥”的测试基线。它与本支线要求的“不同账号并行”存在语义冲突，需要后续先重新定义锁的粒度，再修改测试。

## 4. 豆包执行链路

`GenerationOrchestrator.runDoubao()` 的顺序是：

1. `beginBrowserTask()`：确保对应账号窗口处于任务现场；
2. 生成阶段写入 `checking_login`；
3. 解析并校验任务参考图片；
4. 写入 `uploading_references`；
5. 调用 `AgentBridge.browser.execute()`；
6. 如果返回人工验证，任务进入 `awaiting_verification`；
7. 如果确认生成，任务进入 `generating` 并调度监控；
8. 如果已经捕获结果，导入租户素材中心；
9. 调用 `completeTask()` 校验证据链和唯一归属；
10. 清理监控，更新任务坞，释放账号。

## 5. 登录、人工验证和原 conversation 恢复

### 5.1 登录检测

`BrowserController.runGeneration()` 先执行 `detect()`：

- Cookie 检查 `sessionid/sid_tt/sid_guard/uid_tt` 等登录 Cookie；
- DOM 检查登录按钮和验证提示；
- 未登录返回 `DOUBAO_LOGIN_REQUIRED`；
- 该错误标记 `notSentVerified: true`、`safeToRetry: true`，允许用户重新登录后安全创建子任务。

### 5.2 人工验证

检测到验证码/人工验证时：

- BrowserController 返回 `verificationRequired/paused`；
- Orchestrator 把任务置为 `awaiting_verification`；
- 保存账号、conversation 和验证证据；
- EmbeddedBrowserManager 保持窗口可见并闪烁；
- 用户完成验证后通过 `generation.resume(taskId)` 继续。

`resume()` 使用任务中的 `accountId` 和 `conversationId`，BrowserController 的 `resume` 分支只恢复监控，不重新填入提示词，也不重新点击发送。

### 5.3 发现的 lease 风险

`GenerationOrchestrator.resume()` 先 `acquireAccount(task)`，再直接调用 `runDoubao(task, "resume")`，自身没有 `try/finally`。

如果恢复后发生终止失败、异常或某些非正常返回，可能无法经过统一的释放路径，造成账号 lease 残留。需要增加专门的 resume 异常路径测试，确认：

- 再次人工验证时必须继续持有账号；
- 明确终止失败时必须释放账号；
- 非终止异常时必须记录状态并释放账号；
- 任务取消时必须清理 lease、监控定时器和窗口活动任务。

## 6. 参考图和参数链路

### 6.1 参考图

`resolveTaskReferenceAssets()` 从任务的 `assetIds` 解析租户素材真实路径，再与 `referenceAssets` 中的角色元数据合并，最后按 `order` 排序。

支持的角色包括：

- character / 人物
- scene / 场景
- prop / 道具
- costume / 服装
- pose / 姿势
- style / 风格
- first-frame / 首帧
- last-frame / 尾帧
- other / 其他

`BrowserController` 会：

1. 校验图片真实存在、扩展名和数量上限；
2. 逐张触发文件输入控件；
3. 记录 `requestedCount/uploadedCount/items/verified`；
4. 按图号形成 manifest；
5. 将 manifest 和上传证据写入提交 evidence。

### 6.2 参数

前端、WorkbenchDataBridge 和 BrowserController 均保留：

- `Seedance 2.0 Fast`
- `Seedance 2.0 Mini`
- `自动、3:4、4:3、9:16、16:9、1:1、21:9`
- `4s` 至 `15s`

这些参数在首页、无限画布和任务重试弹窗中都有入口。

## 7. 提交识别和 submission_unknown

### 7.1 当前证据链

`readSubmissionState()` 只在当前 conversation 范围内寻找：

- 当前 conversation ID；
- 当前用户消息或 prompt token；
- 当前消息后的生成信号；
- 视频生成网络请求；
- 当前会话的验证码；
- 豆包终止信号；
- 额度提示。

只出现旧侧栏“生成中”、单独 conversation ID、普通聊天请求或孤立用户消息时，不确认提交。

### 7.2 当前保护行为

提交证据不足时：

```text
state = submission_unknown
safeToRetry = false
notSentVerified = false
account lease = 保持
自动重提 = 禁止
```

客户端重启后，`recoverInterruptedTasks()` 也会重新保持账号并安排 `auditSubmissionUnknown()`，不会自动重新发送提示词。

### 7.3 发现的自动重提冲突

在首次发送后的 30 秒证据窗口内，代码存在一条特殊分支：

```text
after.userMessage && after.explicitFallback
    → retryCount = 1
    → 再次填入提示词
    → 再次点击发送
```

该分支被现有 `test-submission-lifecycle.cjs` 明确断言为“提交失败只允许一次明确回退重试”。从本支线的新规则看，这属于自动重提，至少需要重新定义为“仅在发送动作明确失败且未产生任何提交证据时允许”，不能以模糊的 `explicitFallback` 作为充分条件。

## 8. 结果捕获、下载和一对一绑定

### 8.1 结果捕获

监控阶段：

1. 恢复原 conversation；
2. 检查当前会话的生成状态和网络响应；
3. 通过 CDP/DOM 找到视频资源；
4. 使用账号 Cookie 下载；
5. 写入租户 `downloads`；
6. 校验 MP4 文件头；
7. 导入当前项目的素材中心。

### 8.2 一对一约束

`WorkbenchDataBridge.completeTask()` 校验：

- 结果素材存在且属于任务项目；
- 结果素材不能被其他任务占用；
- `resultVid` 不能被其他任务占用；
- evidence tenant 必须等于当前租户；
- evidence account 必须等于任务账号；
- evidence conversation 必须等于任务 conversation；
- 必须存在有效 `submittedAt`。

因此“结果 URL、视频文件、素材、任务、账号、conversation 一对一绑定”在数据层已有较强保护。

### 8.3 发现的结果下载失败缺口

`BrowserController.execute({action:"monitor"})` 捕获下载异常后返回：

```text
state: generating
videoPending: true
videoError: <错误文本>
```

Orchestrator 会继续安排下一次监控，但当前没有明确的豆包专用失败码，例如：

```text
DOUBAO_RESULT_DOWNLOAD_FAILED
category: result_download
retryMode: recover_result
accountAction: hold/release（需按是否仍可安全访问原会话定义）
```

这会导致“结果下载失败”与“仍在生成”在任务层面混淆。需要补充状态机和结果恢复测试，确保下载失败只做结果恢复，不重新生成。

## 9. 失败分类现状

`classifyDoubaoFailureMessage()` 已覆盖：

| 需求 | 当前代码 |
|---|---|
| 内容违规 | `DOUBAO_CONTENT_REJECTED` |
| 内容/素材侵权 | 内容规则 + `DOUBAO_COPYRIGHT_ASSET_REJECTED` |
| 真实人脸 | `DOUBAO_FACE_REFERENCE_REJECTED` |
| 素材违规 | `DOUBAO_ASSET_REJECTED` |
| 参数不支持 | `DOUBAO_PARAMETER_REJECTED` |
| 登录失效 | `DOUBAO_LOGIN_REQUIRED` |
| 服务繁忙 | `DOUBAO_SERVICE_BUSY` |
| 生成失败 | `DOUBAO_GENERATION_FAILED` |
| 额度耗尽 | `DOUBAO_VIDEO_QUOTA_EXHAUSTED` |
| 提交未知 | 状态机 `submission_unknown`，不是 provider classifier |
| 结果下载失败 | 当前没有独立豆包失败码，需补齐 |

终止失败统一走 `handleProviderTerminalFailure()`，保存 provider message、failure code/category、retryMode、userAction、evidence，并释放账号。

## 10. 额度锁和北京时间重置

`WorkbenchDataBridge` 使用：

```text
shanghaiDateKey()
nextShanghaiMidnight()
markDoubaoQuotaExhausted()
nextDoubaoQuotaReset()
```

调度器在提交阶段或监控阶段确认额度耗尽时：

- 为账号+模型写入 quota block；
- 记录账号、模型、原因、重置时间和发现阶段；
- 自动模式排除当前账号并切换候选账号；
- 所有候选账号均被锁定时进入 `awaiting_quota`；
- 定时器到北京时间零点后重新排队执行。

这部分与要求一致，但需要补测：监控阶段额度耗尽后保留/清理 conversation evidence 的边界，以及人工指定单账号时是否应始终进入等待额度而不是切号。

## 11. 当前测试覆盖与缺口

已有专项测试：

- `test-doubao-quota-scheduler.cjs`
- `test-doubao-failure-outcomes.cjs`
- `test-doubao-failure-persistence.cjs`
- `test-doubao-multi-task-recovery.cjs`
- `test-doubao-live-dock-reference-intelligence.cjs`
- `test-doubao-reference-upload-material-refresh.cjs`
- `test-doubao-result-capture.cjs`
- `test-submission-evidence.cjs`
- `test-submission-lifecycle.cjs`
- `test-floating-browser-runtime.cjs`
- `test-real-concurrency-live.cjs`

需要新增或改写的确定性测试：

1. 两个不同账号的初次 `generate` 必须可以重叠执行；同账号必须排队。
2. 任何 `submission_unknown` 路径都不能调用第二次 `clickComposerSend()`。
3. `resume()` 在终止失败、普通异常、再次验证和取消四种路径下都正确清理/保持 lease。
4. 结果下载失败必须记录明确的恢复状态和失败码，不得创建子生成任务。
5. 结果恢复必须复用原 task/account/conversation/evidence，不得清空原提交证据。
6. 参考图上传证据和顺序在失败、重启、监控和结果回填后仍可追踪。
7. 额度锁按账号+模型隔离，并按 Asia/Shanghai 下次重置时间恢复。

## 12. 后续实施顺序

第一优先级：重新定义提交锁粒度，拆除不同账号之间不必要的全局初次提交串行。  
第二优先级：移除或收紧 `explicitFallback` 自动重提，先补 `submission_unknown` 禁止二次发送测试。  
第三优先级：补齐 `resume()` lease 清理和结果下载失败状态机。  
第四优先级：补充结构化运维日志，至少带 `tenantId/taskId/accountId/conversationId/stage/evidenceFingerprint`，禁止记录 Cookie、API Key 和完整 prompt。  
第五优先级：修复 Electron/CDP 测试环境后，再运行真实窗口、多账号并发和人工验证回归。

本阶段结论：现有实现已经覆盖大部分功能骨架和数据保护，但“不同账号并行”“绝不自动重提”和“结果下载失败独立恢复”需要在下一阶段作为明确的状态机修复点处理。
