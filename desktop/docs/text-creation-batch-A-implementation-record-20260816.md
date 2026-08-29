# 文本创作批次 A 实施记录

执行日期：2026-08-16  
支线：`text-creation-optimization`  
批次：`A`  
状态：代码实现和静态回归完成，真实 UI 验收环境阻塞，暂不并入发布主线

## 本批次实现

### 三栏工作台

在现有文本工作区右侧增加独立协作栏，形成：

`创作会话 / 目录` → `正文编辑器` → `AI 协作、文本素材库、资料研究`

右侧当前提供工作区壳和后续能力占位，不提前接入真实 AI 生成或素材写入。

### 两侧宽度调整

- 左栏：220–420 px，默认 270 px；
- 右栏：320–620 px，默认 460 px；
- 左右分隔线支持鼠标拖动；
- 双击分隔线恢复默认宽度；
- 分隔线支持键盘方向键微调，`Home` 恢复默认；
- 拖动过程中锁定页面选择，结束后保存宽度。

### 收起和展开

- 左侧目录栏可以收起为窄图标栏；
- 右侧协作栏可以收起为窄图标栏；
- 重新点击窄栏按钮可以展开；
- 窄窗口优先收起两侧，保证正文区域可用；
- 收起状态与宽度分别保存。

### 状态持久化

布局状态保存在渲染端 `localStorage`，键按：

`租户标识 + 当前项目 ID`

保存内容仅包括布局宽度、收起状态和界面局部状态，不包含正文、密钥、Cookie、账号 Profile 或模型凭据。

## 文件边界

本批次新增：

- `src/renderer/text-workspace-layout.js`
- `scripts/test-text-workspace-layout.cjs`

本批次修改：

- `src/renderer/index.html`：加载文本布局适配脚本；
- `src/renderer/styles/text-workspace.css`：三栏、分隔线、侧栏和协作栏样式；
- `src/renderer/styles/text-workspace-responsive.css`：窄窗口布局保护。

本批次没有修改：

- `src/main/**`、`src/preload/**`；
- `generation-orchestrator.cjs`、`workbench-data-bridge.cjs`；
- 豆包、无限画布、任务坞、任务中心后台和模型网关；
- 现有 `text-workspace.js` 正文保存、版本、素材引用业务逻辑。

## 测试结果

已通过：

- 布局专项：9/9；
- 原文本工作区：21/21；
- 项目基础回归：17/17；
- 新增脚本语法检查通过。

环境阻塞：

- 响应式运行测试仍因没有可连接的 CDP 页面而 `fetch failed`；
- 开发预览启动因当前环境没有可识别的 Electron CLI 而失败：`electron is not recognized as an internal or external command`；
- 因此尚未完成真实鼠标拖动、双击复位、侧栏收起、窗口缩放和重启恢复验收。

## 快照与合并

post-test 快照：

`backups/text-creation-optimization-20260816/batch-A-posttest-20260816-2159/`

快照文件 12/12 校验一致。当前状态应作为独立预览候选，不应在 UI 验收前标记为正式发布或并入最终交付包。

另外，`generation-ui.js` 在批次 0 后已出现共享工作区哈希变化；该变化在批次 A 前已存在，本批次未修改，已在 post-test manifest 中单独注明。

## 下一步

1. 准备可运行的 Electron/CDP 预览环境；
2. 完成桌面真实交互验收；
3. 若 UI 验收通过，再由用户确认是否并入主线；
4. 之后进入批次 B，建立素材中心同源的文本素材库视图。
