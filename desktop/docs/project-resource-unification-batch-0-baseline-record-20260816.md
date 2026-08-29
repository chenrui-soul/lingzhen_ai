# 项目资源库支线批次 0 基线记录

支线：`project-resource-unification`  
批次：`0`  
开始时间：2026-08-16（Asia/Shanghai）  
完成时间：2026-08-17 00:08（Asia/Shanghai）  
状态：已完成；尚未开始功能开发

## 一、批次目标

本批次只执行以下工作：

1. 建立独立文件快照支线；
2. 冻结当前源码、测试、参考数据和文档基线；
3. 记录 SHA-256 回滚清单；
4. 执行项目素材及跨模块保护测试；
5. 启动隔离 `userData` 预览；
6. 保存项目管理、素材中心和豆包视频复制控件的运行证据；
7. 确认批次 A 的文件白名单和保护边界。

本批次没有修改项目资源库、豆包、任务、文本、画布、模型网关或调度器的功能代码。

## 二、支线与备份

### 2.1 支线位置

```text
backups/project-resource-unification-20260816/
```

### 2.2 基线快照

```text
backups/project-resource-unification-20260816/baseline/
```

快照包含：

- `src/`
- `assets/`
- `references/`
- `scripts/`
- `tests/`
- `docs/`
- `package.json`
- `package-lock.json`
- `README.md`
- `references-infinite-canvas-package.json`

快照统计：

| 项目 | 数量 |
|---|---:|
| 文件数 | 257 |
| 总大小 | 1,851,544 字节 |
| 缺失文件 | 0 |

完整清单：

```text
backups/project-resource-unification-20260816/baseline/manifest.json
```

清单 SHA-256：

```text
9DA6F83085E09929F8646171560C3696437B0CD8913E66B2D9F8439DA1F1F668
```

### 2.3 支线元数据

```text
backups/project-resource-unification-20260816/branch.json
```

支线状态已经标记为 `batch-0-complete`，并记录批次 A 白名单、受保护文件、测试矩阵和运行证据位置。

## 三、批次 A 白名单

允许修改：

- `src/renderer/app.js`
- `src/renderer/project-materials.js`
- `src/renderer/styles/project-materials.css`
- `src/renderer/index.html`
- `scripts/test-project-resource-unification.cjs`
- `scripts/test-project-resource-doubao-copy.cjs`
- `references/project-resource-unification-ground-truth.json`
- 项目资源库方案和实施记录

第一批不得修改主进程、preload、豆包、任务、文本或画布代码。

## 四、受保护文件复核

批次 0 完成时，以下直接相关与受保护文件和基线快照哈希完全一致：

- `src/renderer/app.js`
- `src/renderer/project-materials.js`
- `src/renderer/styles/project-materials.css`
- `src/renderer/index.html`
- `src/main/workbench-data-bridge.cjs`
- `src/main/generation-orchestrator.cjs`
- `src/main/embedded-browser-manager.cjs`
- `src/renderer/task-center.js`
- `src/renderer/generation-ui.js`
- `src/renderer/text-workspace.js`
- `src/renderer/infinite-canvas.js`
- `src/preload/preload.cjs`
- `src/main/main.cjs`

结论：批次 0 没有改变上述功能实现。

## 五、测试结果

测试记录：

```text
backups/project-resource-unification-20260816/batch-0-test-matrix.json
```

测试记录 SHA-256：

```text
F3F5958D961DBD954E2B4889C2348E9A5582A81016879C8657DB82FB39182A9D
```

### 5.1 汇总

| 项目 | 结果 |
|---|---:|
| 测试套件 | 22 |
| 有断言计数的套件 | 21 |
| 断言总数 | 303 |
| 通过 | 303 |
| 失败 | 0 |
| 内测 HTTP 构建预检 | 通过 |

### 5.2 核心测试

| 测试 | 结果 |
|---|---:|
| 项目与素材 | 27/27 |
| 多任务任务坞 | 27/27 |
| 任务中心 | 20/20 |
| 文本工作区 | 21/21 |
| 无限画布回归 | 20/20 |
| 统一执行 | 7/7 |
| 人工核对操作 | 10/10 |
| 豆包运维不变量 | 6/6 |
| 提交未知恢复 | 6/6 |
| 豆包结果捕获 | 9/9 |
| 提交证据 | 20/20 |
| 提交生命周期 | 13/13 |
| 基础冒烟 | 17/17 |

### 5.3 增强保护测试

| 测试 | 结果 |
|---|---:|
| 豆包失败结果 | 18/18 |
| 豆包失败持久化 | 10/10 |
| 豆包额度调度 | 14/14 |
| 豆包多任务恢复 | 15/15 |
| 模型结果恢复 | 5/5 |
| 文本素材契约 | 13/13 |
| 无限画布边界 | 13/13 |
| 无限画布结果恢复 | 12/12 |

## 六、运行预览证据

### 6.1 隔离预览

隔离数据目录：

```text
.local-user-data-project-resource-batch0-20260816/
```

运行端口：`9334`  
运行状态：正常，保留运行  
账号、Cookie、浏览器 Profile：未复制  
设备密钥：未写入隔离目录

隔离环境因没有复制授权信息，显示设备密钥激活遮罩。这是预期状态；遮罩下的项目管理、素材中心和首页路由已经完成 DOM 级校验。

隔离报告：

```text
backups/project-resource-unification-20260816/runtime-evidence/runtime-baseline-report.json
```

隔离报告 SHA-256：

```text
88F61CE4D19ABEAE01921F9D35AF8E6C60B7E0CCA3146FA7A62CB07303AEA0EE
```

### 6.2 已授权现有数据预览

运行端口：`9222`  
运行状态：正常，保留运行  
操作性质：只读导航和截图，未创建任务、未改变素材、未改变账号状态

运行数据：

| 项目 | 数量 |
|---|---:|
| 项目 | 1 |
| 素材 | 18 |
| 任务 | 23 |
| 可见豆包视频 URL 复制按钮 | 7 |
| 可见豆包视频选择按钮 | 7 |
| 批量复制按钮 | 存在 |
| 当前筛选全选按钮 | 存在 |

运行报告：

```text
backups/project-resource-unification-20260816/runtime-evidence/live-runtime-baseline-report.json
```

运行报告 SHA-256：

```text
29B3CC3685F83D2BF7200D5F2ABB5AC01EEB587FC2F03501B05B23E7FF3D49C4
```

### 6.3 截图

- `runtime-evidence/batch0-project-management-baseline.png`
- `runtime-evidence/batch0-material-center-baseline.png`
- `runtime-evidence/batch0-home-baseline.png`
- `runtime-evidence/live-batch0-project-management-baseline.png`
- `runtime-evidence/live-batch0-material-center-baseline.png`
- `runtime-evidence/live-batch0-home-baseline.png`

## 七、发现的既有基线问题

已授权预览在应用启动后的异步首页增强阶段，如果立即切换到项目管理，`app-fixes.js` 中已经开始的首页异步增强可能把项目管理页标题临时改成首页标题：

```text
期望：项目管理
实际：灵感，即刻成帧。
```

项目管理主体、指标、项目卡片和操作按钮已经正确渲染，因此不是项目数据丢失，也不是项目路由失败。

该问题在批次 0 只记录、不修复。批次 A 建立统一项目资源库壳层时必须增加页面标题隔离测试，确保异步首页增强不能覆盖资源库标题。

## 八、共享工作区并行变化

基线冻结后，检测到共享工作区有其他模块的并行修改，涉及：

- `src/renderer/canvas-flow-core.js`
- `src/renderer/styles/text-workspace.css`
- 两个无限画布 ground truth
- 三个无限画布测试脚本
- 一个文本响应式测试脚本
- 测试日志

这些修改不由本批次产生，均未回滚或覆盖。项目资源库支线会：

1. 保留这些并行修改；
2. 不把它们纳入项目资源库白名单；
3. 合并时只提交项目资源库白名单文件；
4. 在批次 A 开始前再次核对共享工作区状态；
5. 最终回归使用合并时的最新共享主线，而不是强行恢复旧文件。

## 九、批次 0 结论

批次 0 已完成：

- 基线备份完整；
- 回滚清单完整；
- 303/303 断言通过；
- 内测 HTTP 构建预检通过；
- 隔离预览和已授权预览均已保存；
- 豆包视频单条选择、复制和批量操作控件已留证；
- 直接相关和受保护文件未改变；
- 并行模块修改已识别并隔离；
- 已记录项目管理标题的既有异步覆盖问题。

允许进入批次 A，但必须继续遵守 renderer 第一批白名单，不得顺带修改豆包、任务、文本、画布、模型网关和调度器。
