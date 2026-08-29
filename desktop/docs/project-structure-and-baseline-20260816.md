# 灵帧AI桌面客户端 V0.12.2 项目结构与现有基线

审计日期：2026-08-16（Asia/Shanghai）  
审计对象：`lingzhen_ai_desktop_v1`  
审计方式：目录/源码/配置/测试/`ground-truth` 只读检查，并运行可执行的 Node 测试。

## 1. 结论摘要

这是一个基于 Electron 31 的多模型创作桌面工作台，当前实现包含：

- 设备密钥激活、签名租户身份和租户目录隔离；
- 自定义模型网关，支持 OpenAI Compatible、Responses、Anthropic Compatible 和自定义 JSON；
- 豆包账号的独立浏览器窗口、独立持久化分区、多账号并发和同账号串行；
- 任务中心、实时任务坞、失败分类、安全重试、人工验证和结果恢复；
- 创作首页、文本创作、素材/项目管理、无限画布和短剧模板。

当前版本的“源码基线”是 `package.json` 的 `0.12.2`，但 `README.md` 的标题和主体说明仍写作 V0.12.1，说明版本文档没有完全同步。

当前工作区实际上是“内测 HTTP 构建状态”，不是正式 HTTPS 发布状态：`assets/connection-bootstrap.json` 使用公网 HTTP 引导地址并设置 `allowPublicHttp: true`。正式构建前必须重新写入 HTTPS 引导配置；现有 `preflight:dist` 会拒绝当前配置，而 `preflight:dist:internal-http` 可以通过。

## 2. 目录现状

```text
lingzhen_ai_desktop_v1/
├─ assets/                         发布随包资源与连接引导配置
│  ├─ lingframe.ico
│  ├─ lingframe-mark.png
│  └─ connection-bootstrap.json
├─ src/
│  ├─ main/                        Electron 主进程与业务桥接
│  ├─ preload/                     contextBridge 安全 API
│  └─ renderer/                    HTML/CSS/经典脚本渲染层
├─ tests/                          10 个入口级/基础测试
├─ scripts/                        专项测试、采集、构建和验证脚本
│  └─ log/                         测试运行产生的 JSON/截图/追踪日志
├─ references/                     47 份 Ground Truth、夹具和验收结果
├─ docs/                           功能设计与历史发布说明
├─ package.json                    Electron 31 / electron-builder 26 配置
├─ package-lock.json
├─ references-infinite-canvas-package.json
├─ .local-user-data/               本机运行数据（约 35 MB）
├─ .local-user-data-fixed/         本机修复/验收数据（约 8 MB）
├─ node_modules/                   已安装 Node 包（约 84 MB）
├─ dist-exe-final/                 Windows 安装包和解包目录（约 332 MB）
├─ dist-exe-activation-fix/        另一份 Windows 安装包和解包目录（约 332 MB）
├─ dist-exe-20260816/              当前为空的输出目录
└─ account_account-1/              空的账号目录残留
```

### 2.1 规模统计

| 区域 | 文件数 | 约占用 | 说明 |
|---|---:|---:|---|
| `src/main` | 11 | 289 KB | 主进程业务核心 |
| `src/preload` | 1 | 5 KB | 75 个 IPC invoke 的公开桥接 |
| `src/renderer` | 27 | 515 KB | 15 个 JS、11 个 CSS、HTML |
| `src` 合计 | 39 | 810 KB | 实际产品源码 |
| `tests` | 10 | 18 KB | 基础测试入口 |
| `scripts` 代码 | 69 | 357 KB | 专项测试/构建/采集 |
| `references` | 47 | 39 KB | 验收契约和夹具 |
| `docs` | 4 | 10 KB | 设计与发布记录 |
| `node_modules` | 8,555 | 84 MB | 不应作为源码交付内容 |
| `dist-exe-*` | 152 | 约 696 MB | 不应放在源码工作区作为日常开发输入 |

当前项目没有项目级 `.gitignore`，并且当前目录不是 Git 仓库根目录。这会让构建产物、本机数据和测试日志很容易与源码混在一起。

## 3. 运行时架构

```text
Electron main.cjs
  ├─ ConnectionConfig ── 签名远程连接配置、主备地址、缓存、管理员覆盖
  ├─ LicenseClient ───── 设备密钥、签名授权、租户 grant、离线宽限
  ├─ DesktopIdentity ─── verified tenantId / agent identity
  ├─ AgentBridge ─────── 后台 Agent 注册、token 交换、轮询和结果上传
  ├─ EmbeddedBrowserManager
  │    └─ BrowserWindow（每个豆包账号一个持久化 partition）
  ├─ BrowserController ─ CDP/真实浏览器自动化、提交、上传、监控、失败识别
  ├─ WorkbenchDataBridge ─ 项目、素材、文本、任务、额度状态本地持久化
  ├─ ModelGatewayBridge ── 厂商/模型/密钥/生成请求/结果查询
  └─ GenerationOrchestrator ─ 统一执行、调度、重试、恢复、结果回填
          ▲
          │ IPC（75 个 ipcMain.handle）
          ▼
preload.cjs → window.lingframe（contextIsolation=true，nodeIntegration=false）
          ▲
          ▼
renderer/index.html
  ├─ app.js                主壳、导航、页面初始结构
  ├─ app-fixes.js          首页增强、模型/素材/任务提交和大量 DOM patch
  ├─ home-conversations.js 首页本地对话
  ├─ project-materials.js  项目/素材 UI
  ├─ text-workspace.js     文本会话、版本和自动保存
  ├─ task-center.js        任务列表与详情
  ├─ generation-ui.js      生成弹窗和任务坞
  ├─ desktop-ui.js         标题栏、豆包账号和内嵌窗口控制
  ├─ model-gateway.js      模型网关设置页
  ├─ canvas-flow-core.js   画布 DAG/类型/拓扑核心
  ├─ infinite-canvas.js    无限画布 UI、执行和结果回填
  └─ display-preferences.js 外观、字号、对比度和主题
```

## 4. 主进程模块职责

| 文件 | 当前职责 | 规模/注意点 |
|---|---|---|
| `main.cjs` | 创建窗口、初始化服务、租户目录、注册所有 IPC、退出清理 | 75 个 IPC 集中在一个文件，后续适合按域拆分 handler |
| `connection-config.cjs` | 引导配置、签名 envelope、主备 failover、缓存、管理员覆盖 | 内测 HTTP 由引导文件控制；正式构建有 preflight 保护 |
| `license-client.cjs` | 设备指纹、激活/刷新、grant 签名校验、离线状态 | 授权数据写入 `system/license-binding-v290.json` |
| `desktop-identity.cjs` | 从设备 license 或已验证 Agent 配置获得 tenantId | 明确禁止把本地 token 文本直接当 tenantId |
| `agent-bridge.cjs` | Agent 注册、从 license grant 交换 token、轮询命令、上传结果 | 依赖服务端 tenant 校验和本地 agent 配置 |
| `embedded-browser-manager.cjs` | 每账号 BrowserWindow、partition、显示/隐藏/弹出/边界 | `BrowserWindow` 运行时测试依赖 Electron 二进制 |
| `browser-controller.cjs` | Chrome/Edge/CDP、豆包模式、参考图上传、提交证据、结果监控、失败分类 | 最大主进程文件，约 94 KB / 928 行，职责高度集中 |
| `video-downloader.cjs` | 下载并校验视频文件，支持外部下载工具探测 | 输出到租户 `downloads` |
| `workbench-data-bridge.cjs` | 项目、素材、文本版本、任务、额度锁定、恢复/删除/回收站 | 约 52 KB / 373 行；使用 JSON 数据库和文件素材 |
| `model-gateway-bridge.cjs` | 厂商/模型 CRUD、密钥加密、本地发现、生成/查询、结果 URL 提取 | 密钥与状态分文件保存 |
| `generation-orchestrator.cjs` | 豆包/模型网关统一任务执行、账号锁、监控、配额切换、结果恢复 | 约 42 KB / 300 行；状态机和定时器较复杂 |

## 5. 租户数据和持久化边界

主进程以 Electron `userData` 为根，分成：

```text
<userData>/
├─ system/
│  ├─ license-binding-v290.json
│  ├─ verified-agent-identity.json
│  ├─ connection-config-cache.json
│  ├─ connection-admin-override.json
│  └─ agent/（agent-config.json、agent-id.txt）
└─ tenants/<verifiedTenantId>/
   ├─ database/workbench-data-v1.json
   ├─ database/model-gateway-v1.json
   ├─ database/model-provider-secrets-v1.json
   ├─ materials/<projectId>/<assetId>.<ext>
   ├─ downloads/
   ├─ documents/
   ├─ chrome-profiles/
   ├─ embedded-browser-profiles/
   ├─ task-cache/
   └─ logs/
```

关键边界已经写入测试基线：`tenantId` 必须来自服务端验证；不同租户不能看到项目、素材、文本或任务；豆包账号的 Cookie/Profile 只在本租户、账号专属 partition 下保存；任务素材必须属于任务项目。

## 6. 前端现状和结构风险

渲染层通过 `index.html` 以经典 `<script>` 顺序加载，模块没有 ES Module、TypeScript 或打包边界。当前 15 个 JS 文件依赖全局变量和事件名，例如 `window.lingframe`、`window.lingframeAccountStore`、`lingframe:generation-status`。

主要结构风险：

1. `app.js` 先生成基础页面，`app-fixes.js` 再通过 DOM 查询和事件代理“补丁式”增强，功能正确性依赖脚本加载顺序。
2. `browser-controller.cjs`、`workbench-data-bridge.cjs`、`infinite-canvas.js`、`app-fixes.js`、`desktop-ui.js` 都较大，领域职责和 UI/状态/持久化逻辑交叉。
3. 大量文件是少行数超长行格式，审查、定位、冲突合并和精确回归困难。
4. IPC 名称在 `main.cjs` 和 `preload.cjs` 手工重复维护，缺少单一契约定义。
5. 测试既有 `tests/`，又有 `scripts/test-*`、`scripts/verify-*`、`scripts/capture-*`，入口和结果目录没有统一分层。

建议的后续结构目标不是立即重写，而是逐步建立：`main/handlers/<domain>`、`main/services/<domain>`、`renderer/modules/<domain>`、共享 IPC 常量、统一测试命令和独立 `artifacts/` 输出目录。

## 7. 功能 Ground Truth 基线

### 7.1 桌面壳、身份和连接

- 导航必须包含：创作首页、素材中心、项目管理、文本创作、任务中心、豆包管理、无限画布、短剧模板、系统设置。
- 1920×1080、1366×768、1280×720 不允许横向溢出，原品牌 Logo 必须保留。
- tenantId 只能来自已验证 license grant 或已验证 Agent register response。
- 无效 Agent token、租户不匹配、错误命令回传必须在服务端协议层拒绝。
- 连接配置支持主备引导、签名缓存、离线签名缓存、配置篡改拒绝、普通租户隐藏服务地址、管理员签名切换。
- V0.12.2 新增：严格模式拒绝公网 HTTP，内测模式允许公网 HTTP，混合 HTTP/HTTPS failover 仍可用。

### 7.2 模型网关

- 协议：`openai-compatible`、`openai-responses`、`anthropic-compatible`、`custom-json`。
- 支持厂商 CRUD、模型发现、模型能力推断、连接测试、生成和异步结果查询。
- API Key/自定义 Header 不通过公开 UI 返回明文；本地保存为加密 secret payload。
- URL 必须拒绝 `file:`、`javascript:`、`ftp:` 等危险协议。

### 7.3 项目、素材和文本

- 素材类型基线：图片、视频、文本；扩展名覆盖 jpg/jpeg/png/webp/mp4/mov/webm/m4v/txt/md/json/csv。
- 新租户默认一个项目；项目/素材按租户隔离；任务结果必须绑定项目。
- 文本类型覆盖小说、故事、广告文案、短视频文案、剧本、分镜、提示词、人物设定、世界观。
- 文本支持多会话、自动保存、版本快照、恢复、删除/回收站和素材引用。

### 7.4 任务和统一执行

任务状态基线包含：`draft`、`queued`、`preparing`、`submitting`、`generating`、`awaiting_login`、`awaiting_verification`、`submission_unknown`、`awaiting_quota`、`completed`、`failed`、`cancelled`。

- 豆包：同一账号串行，不同账号并行；模型网关任务不进入豆包账号队列。
- `submission_unknown` 不自动重提，也不自动释放账号供复用。
- 人工验证码/登录完成后，在原账号窗口和原 conversation 上继续观察。
- 安全重试创建子任务，原任务、提示词、素材和失败证据保留。
- 结果 URL、视频文件、素材、任务保持一对一；结果恢复只下载/恢复，不重新生成。
- 全局任务坞在页面切换后仍存在，支持运行/排队/关注计数和任务详情跟随。

### 7.5 豆包专项

- Seedance 2.0 Fast/Mini；比例：自动、3:4、4:3、9:16、16:9、1:1、21:9；时长 4–15 秒。
- 参考图支持人物、场景、道具、服装、姿势、风格、首帧、尾帧等角色说明，上传顺序和上传证据必须保留。
- 失败分类覆盖内容违规、素材违规、参数不支持、登录失效、服务繁忙、生成失败、额度耗尽、提交未知、结果下载失败。
- 额度锁按 Asia/Shanghai 日期和下次重置时间维护；所有账号额度耗尽时等待重置。

### 7.6 无限画布和短剧模板

- 画布为独立模块，不修改豆包、任务中心、模型网关和既有调度器。
- 支持 DAG 校验、类型兼容、循环保护、右键/拖线新增节点、上游信息传递、自动保存、历史版本、撤销/重做、当前节点/整套流程执行。
- 媒体模型 V2 支持 text/image/video/audio 输入，image/video/audio 生成节点，音频 `.mp3` / `audio/mpeg`，内联参考上限 32 MB。
- 画布执行仍进入统一 `generation.create()`，结果通过任务、会话、素材和模型引用回填。

### 7.7 外观和响应式

- 主题：light、comfort、dark；字号：standard、large、xlarge；对比度：standard、soft、clear。
- 正文对比度目标不低于 4.5；外观设置保存在本机 `localStorage`。
- 画布舞台随窗口高度增长，底部空白目标不超过 14 px，横向溢出不超过 1 px；侧栏字号需要明显大于节点内部字号。

## 8. 测试体系和当前执行结果

### 8.1 可直接运行的基础命令

```powershell
npm test
npm run preflight:dist
npm run preflight:dist:internal-http
```

本次执行结果：

| 命令 | 结果 | 说明 |
|---|---|---|
| `npm test` | 17/17 通过 | 基础文件、品牌、导航、Electron 安全配置、单实例和窗口控制 |
| `npm run preflight:dist` | 失败（预期） | 当前引导配置允许公网 HTTP，正式构建被正确阻止 |
| `npm run preflight:dist:internal-http` | 通过 | 当前内测 HTTP 构建配置合法 |

### 8.2 已选纯 Node/静态专项测试

本次抽取运行 31 个不依赖真实 UI 的专项脚本：26 个通过，5 个因环境/历史夹具问题失败。通过的覆盖包括：

- 账号分组、桌面身份、连接配置、HTTP 模式、自动监控；
- 豆包失败分类、失败持久化、配额调度、多任务恢复、参考素材智能识别；
- 模型网关、模型结果恢复、统一执行、任务中心、项目素材、文本工作区；
- 无限画布媒体模型、首页账户资料、首页会话静态链路、首页生产流水线；
- 提交证据、提交生命周期、嵌入式浏览器静态契约、生成实时布局。

失败项及性质：

1. `test-doubao-reference-upload-material-refresh.cjs`：8/9；失败项引用已不存在的历史目录 `scripts/release/v0.11.7-e2e-pipeline-hardening-20260815`，属于测试夹具失效，不是当前实现断言失败。
2. `test-floating-browser-runtime.cjs`：Electron 包存在但 `node_modules/electron/dist/electron.exe` 缺失，属于依赖安装不完整。
3. `test-home-conversations-submit-preload.cjs`：同上，无法加载 Electron。
4. `test-home-parameter-restore-preload.cjs`：同上，无法加载 Electron。
5. `test-live-connection-cache-v0121.cjs`：服务/签名配置刷新返回 `INVALID_CONFIG_SIGNATURE`，需要有效签名服务或固定测试注入，不能作为本地纯单元测试稳定运行。

### 8.3 运行时测试条件

以下测试不能仅靠 `node` 在当前环境完成：

- `*-runtime.cjs`、`*-cdp.cjs`、`test-real-concurrency-live.cjs`：需要启动 Electron、CDP 端口 9333、浏览器或真实页面。
- `test-infinite-canvas-ui.cjs`：源码显式依赖 Playwright；当前 `package.json` 没有 Playwright 依赖，`npm list playwright` 为空。
- 真实豆包验收和并发验收：需要有效授权、账号登录、配额、网络和实际生成证据。

## 9. 当前主要问题清单

### P0：发布安全/配置

- 当前 `connection-bootstrap.json` 是公网 HTTP 内测配置，不能用于正式租户包。
- README、package 版本和部分 references 的版本说明不完全一致。
- `productionDomainRequired: false` 是当前内测开关，正式发布前应由配置生成流程明确切换并增加 CI 阻断。

### P1：可维护性

- `main.cjs` 集中 75 个 IPC handler；建议按 window/license/connection/agent/workbench/models/tasks/generation/doubao 分组注册。
- `browser-controller.cjs`、`workbench-data-bridge.cjs`、`infinite-canvas.js` 过大；建议先拆纯函数、状态机、持久化和 UI，再逐步模块化。
- 经典脚本和 DOM patch 依赖加载顺序；建议建立明确的 renderer 模块入口和事件契约。
- 超长单行源码/CSS 影响审查、定位和合并，应先做格式化而不改变行为。

### P1：测试工程

- `tests/` 与 `scripts/test-*` 双入口，缺少统一 test matrix 和标签。
- 测试日志直接写入 `scripts/log`，应迁移到 `artifacts/test-results/<run-id>`。
- 历史 release 快照缺失导致一个专项测试天然失败；应改为携带最小 fixture 或在缺失时明确 `skipped`。
- Electron、Playwright、CDP、真实服务测试没有在 `package.json` 中形成清晰的安装/启动前置检查。

### P2：工作区卫生

- `dist-exe-final` 与 `dist-exe-activation-fix` 约 696 MB，应该移到发布产物目录或版本化制品存储。
- `.local-user-data*`、空账号目录和 `node_modules` 不应进入源码交付包。
- 建议添加 `.gitignore`，至少忽略 `node_modules/`、`dist-*/`、`.local-user-data*/`、`scripts/log/`、`scripts/release/`、临时 profile 和下载目录。

## 10. 建议的优化顺序

1. 先建立可重复基线：补 `.gitignore`、统一 `npm test:unit/test:static/test:runtime/test:all`，保存每次测试的机器可读报告。
2. 修复测试环境：重新安装 Electron 二进制，明确 Playwright 是否纳入开发依赖，清理缺失的历史 release fixture。
3. 先做低风险结构整理：格式化超长文件、把 IPC handler 从 `main.cjs` 移到按域文件，保持 channel 名称不变。
4. 拆分 `WorkbenchDataBridge` 和 `GenerationOrchestrator` 的纯规则层，优先保持 JSON schema 和状态值兼容。
5. 拆分 renderer 的首页/任务/画布/外观模块，逐步减少 `app-fixes.js` 的补丁职责。
6. 最后再做发布流程优化：HTTPS 配置门禁、干净打包目录、安装包内容白名单和正式构建 CI。

## 11. 受保护的人工验收基线

`references/doubao-human-acceptance-protected-baseline.json` 明确要求：任何受保护检查失败都阻止发布；没有新的真实付费/额度验收证据时，不得声称真实生成成功。必须保留的行为包括：

- 每豆包账号一个浮动 BrowserWindow 和一个持久化隔离 partition；
- 同账号串行、不同账号并行、模型网关绕过豆包账号队列；
- 验证码在原窗口/原会话继续；`submission_unknown` 不自动重提；
- 额度耗尽安全切号并按上海时间重置；
- 任务/账号/conversation/视频 URL/本地素材一对一绑定；
- 全局实时任务坞、视频地址复制、Seedance 参数和最新无限画布入口保持可用。

这份保护基线应作为后续结构优化和功能修复的回归红线。
