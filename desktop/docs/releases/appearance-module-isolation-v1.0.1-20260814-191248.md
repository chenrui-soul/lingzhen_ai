# 外观模块隔离修复发布说明

- 发布标识：`appearance-module-isolation-v1.0.1-20260814-191248`
- 发布日期：2026-08-14
- 适用主线：`D:\project_v1\lingzhen_ai_desktop_v1`
- 修改范围：仅 `src/renderer/styles/appearance.css`
- 主线文件 SHA256：`D9FD909C53161570335AFEF72956B2BC0910AC105550A18ECD1B7A2A8E342208`

## 修复内容

1. 豆包账号卡片由固定高度改为自适应高度，避免备注、状态和按钮互相覆盖。
2. 四个账号操作按钮采用两列两行布局，三档字号下均保持在卡片内部。
3. 账号名称、备注和按钮使用独立可读字号，避免全局字号造成横向溢出。
4. 无限画布主体与右侧检查器隔离全局主题和字号变量，保持独立深色工作环境。
5. 无限画布继续作为独立模块显示，不改变其路由、节点执行或数据逻辑。

## 未修改范围

- 后台服务、数据库和租户隔离
- 豆包控制器、登录与任务执行链路
- 模型网关与余额逻辑
- 无限画布节点、连线、运行和结果回填逻辑

## 验证结果

- 外观静态测试：17/17
- 外观 Electron 实测：12/12
- 模块隔离 Electron 实测：8/8
- UI 支线豆包隔离测试：4/4
- 左右侧栏静态测试：23/23
- 左右侧栏 Electron 实测：14/14
- 无限画布综合回归：20/20
- 无限画布 UX：19/19

说明：`test-infinite-canvas-ui.cjs` 本轮没有重新运行，因为主线测试环境缺少 Playwright 依赖；历史结果为 30/30。本次 Electron 模块隔离实测已经覆盖无限画布布局、可视区域、字号和主题回归。本次发布没有安装或变更依赖。

## 包内证据

- 修改后运行结果：`scripts/log/appearance-module-isolation-runtime.json`
- 修改前运行结果：`scripts/log/appearance-module-isolation-runtime-before.json`
- 豆包卡片截图：`scripts/log/appearance-doubao-fixed.png`
- 无限画布截图：`scripts/log/appearance-canvas-isolated.png`
- 侧栏回归结果：`scripts/log/sidebar-toggle.json`
- 无限画布综合结果：`scripts/log/infinite-canvas-regression.json`
- 无限画布 UX 结果：`scripts/log/infinite-canvas-ux.json`

## 回滚方法

原始文件已备份至：

`D:\project_v1\lingzhen_ai_desktop_v1\backups\appearance-module-isolation-v1.0.1-20260814-191248\src\renderer\styles\appearance.css`

如需回滚，先关闭桌面客户端，再将上述备份文件覆盖到：

`D:\project_v1\lingzhen_ai_desktop_v1\src\renderer\styles\appearance.css`

回滚只涉及该 CSS 文件，不需要回滚数据库或后台服务。
