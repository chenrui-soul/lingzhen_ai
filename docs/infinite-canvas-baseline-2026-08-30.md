# 无限画布阶段零基线报告

## 1. 基线信息

- 执行日期：2026-08-30
- 项目目录：`D:\AI漫剧\灵帧AI`
- Git 分支：`main`
- 基线提交：`ea2ce8b`
- Node.js：`v24.19.0`
- npm：`11.17.0`
- 本报告只记录现状，不代表本轮已经实施视觉或交互优化。

## 2. 范围保护

本阶段未修改以下业务代码：

- `desktop/src/renderer/infinite-canvas.js`
- `desktop/src/renderer/styles/infinite-canvas.css`
- `desktop/src/renderer/app.js`
- 任务中心、豆包管理、登录、租户、模型网关和浏览器控制代码

当前工作区在阶段零开始前已经存在未提交改动，均原样保留：

```text
M  desktop/assets/connection-bootstrap.json
M  desktop/references/connection-config-v0121-ground-truth.json
M  desktop/src/renderer/app.js
M  desktop/src/renderer/infinite-canvas.js
M  desktop/src/renderer/styles/infinite-canvas.css
?? docs/
?? 项目目录中的 4 个用户素材文件
```

说明：上述无限画布代码和 `app.js` 改动来自此前工作，不属于阶段零新增；阶段零只新增本报告文件。

## 3. 当前代码指纹

用于后续确认优化是否只发生在允许范围内：

| 文件 | SHA-256 | 大小 |
| --- | --- | ---: |
| `desktop/src/renderer/infinite-canvas.js` | `C00BBA8EB32DFF9E9E6F265600D2589CCDD388C591DE31E57F13C43253E0C58D` | 170509 bytes |
| `desktop/src/renderer/styles/infinite-canvas.css` | `C653B480E39457954F2DBBA58CB27A1663876028CB161999E2124FBB7797EEDC` | 65875 bytes |
| `desktop/src/renderer/app.js` | `529BAFAA9F892B96E90FD9FF83CB349044853E50DFAABE50C6D28DC0100CA149` | 21370 bytes |
| `desktop/assets/connection-bootstrap.json` | `C86F45D2503E7DB26F0BA9AC7797D03507136E2FB4A22B5728AC6A4E25766C4B` | 250 bytes |
| `desktop/references/connection-config-v0121-ground-truth.json` | `E3C1258A04380FD3C0F4634C46FA7DBE1CA0770AFCF8966D3F38C4DA5ECCBE66` | 652 bytes |

此前已存在的代码改动统计：

- `infinite-canvas.js`：220 insertions / 29 deletions
- `infinite-canvas.css`：5 insertions / 0 deletions
- `app.js`：1 insertion / 9 deletions

## 4. 自动化基线结果

### 4.1 通过项目

以下检查全部通过，阶段零记录为当前可用基线：

| 检查 | 结果 |
| --- | ---: |
| `node --check src/renderer/infinite-canvas.js` | PASS |
| `test-infinite-canvas-boundary.cjs` | 13/13 PASS |
| `test-infinite-canvas-execution-envelope.cjs` | 15/15 PASS |
| `test-infinite-canvas-input-adapter.cjs` | 10/10 PASS |
| `test-infinite-canvas-media-model-v2.cjs` | 15/15 PASS |
| `test-infinite-canvas-ux.cjs` | 31/31 PASS |
| `test-infinite-canvas-selection.cjs` | 25/25 PASS |
| `test-infinite-canvas-input-snapshot.cjs` | 19/19 PASS |
| `test-infinite-canvas-input-binding-ui.cjs` | 17/17 PASS |
| `test-infinite-canvas-snapshot-execution.cjs` | 24/24 PASS |
| `test-infinite-canvas-result-recovery.cjs` | 12/12 PASS |
| `test-infinite-canvas-workflow-portability.cjs` | 13/13 PASS |
| `test-infinite-canvas-responsive-runtime.cjs`（连接当前 9333 调试页面） | 5/5 PASS |

这些通过项确认了：画布执行信封、直接上游输入、文字/媒体分离、素材角色、DAG 连接、选择/分组、输入快照、结果恢复和工作流导入导出在当前基线上可用。

### 4.2 可视化检查阻塞项

| 检查 | 结果 | 原因 | 处理决定 |
| --- | --- | --- | --- |
| `test-infinite-canvas-ui.cjs` | BLOCKED | `desktop` 依赖中没有 Playwright，执行时 `Cannot find module 'playwright'` | 阶段零不安装新依赖、不修改测试；后续视觉验收前单独补齐环境 |
| `test-infinite-canvas-isolated-preview.cjs` | 4/5，1 项 FAIL | 隔离预览可以启动，但脚本仍检查旧的 `lingzhen_ai_desktop_v1` URL 标识；当前页面实际指向 `src/renderer/index.html` | 记录为已有测试基线问题，后续先确认测试期望，再决定是否修测试 |

这两个阻塞不等于业务功能失败，但说明当前还不能把自动化截图作为完整的视觉验收依据。

## 5. 当前视觉基线和复现证据

已有用户截图作为阶段零视觉对照，不修改原文件：

- [顶部工具栏文字重复/错位截图](C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-ca06b810-4da8-4675-a4c8-e1aec2d83ac3.png)
- [首屏只有文本输入截图](C:/Users/Administrator/AppData/Local/Temp/codex-clipboard-4ff98bf4-e812-470d-999d-eb7eeee088de.png)

本次根据当前源码和运行页面生成的基线截图：

- [当前无限画布响应式基线截图](D:/AI漫剧/灵帧AI/desktop/scripts/log/infinite-canvas-responsive-xlarge.png)

截图确认当前布局仍存在：应用通用侧栏和画布左右面板占用空间较多、顶部主题/导入/导出文字重复且有下坠错位、首屏创作台仍只有文字输入和快捷卡片。这些作为后续阶段五的对比基线。

已确认需要在后续阶段复现和对比的问题：

- 顶部主题、导入、导出图标下方出现重复大字，工具栏空间利用率低，存在竖排/下坠错位风险。
- 页面标题、副标题、创作台说明和工具按钮说明存在重复信息。
- 首屏缺少图片、视频、音频参考素材入口、项目资产选择、模型/豆包参数和直接生成入口。
- 运行视频时无法顺畅操作其它画布功能，滚轮/平移可能回弹。
- 任务状态刷新可能导致视频预览闪烁或播放状态重置。
- 节点固定尺寸，无法随图片/视频比例和生成比例自然变化。
- 文本、图片、视频节点的编辑和预览形态不够直接。

## 6. 阶段零结论

阶段零已完成以下工作：

- 工作区状态、分支、基线提交和已有改动已登记。
- 修改边界已锁定，未回退或覆盖用户已有改动。
- 无限画布核心自动化基线全部通过。
- 可视化测试的环境缺口和旧检查条件已记录。
- 用户截图已作为视觉对照证据登记。
- 后续执行顺序、完成门槛和回归要求已写入主方案。

阶段零未完成项：

- 尚未安装 Playwright，因此尚未完成自动化 UI 截图基线。
- 隔离预览脚本存在旧 URL 断言，需要后续确认后再处理。
- 尚未修改任何本轮体验优化代码。

补充：当前运行时响应式检查已通过，但它验证的是现有布局在不同窗口高度下的稳定性，并不代表沉浸式布局、工具栏减负或首屏创作台优化已经完成。

下一阶段进入条件：

1. 先决定是否补齐 Playwright 视觉测试环境。
2. 先确认隔离预览旧 URL 断言是否属于测试过期，而不是直接修改业务代码。
3. 阶段一优先处理局部渲染、视口和状态隔离，再进入创作台与视觉布局开发。
