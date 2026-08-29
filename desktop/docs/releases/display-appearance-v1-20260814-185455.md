# 灵帧AI 显示与外观 V1

- 构建时间：2026-08-14 18:54:55（Asia/Shanghai）
- 实施范围：仅桌面版渲染层 UI 与本机显示偏好
- 正式主线：`D:\project_v1\lingzhen_ai_desktop_v1`
- 回滚备份：`D:\project_v1\lingzhen_ai_desktop_v1\backups\display-appearance-v1-20260814-185455`

## 功能

- 主题：跟随系统、深色、明亮、护眼
- 字体：小号、标准、大号、特大
- 文字对比度：柔和、标准、清晰
- 减少光晕、减少动效
- 系统设置中的“显示与外观”面板
- 标题栏快捷主题切换
- 偏好仅保存在本机 `localStorage`，键名为 `lingframe.appearance.v1`

## 同步文件

- `src/renderer/index.html`
- `src/renderer/display-preferences.js`
- `src/renderer/styles/appearance.css`

主线原有 `canvas-flow-core.js`、`infinite-canvas.js` 和 `infinite-canvas.css` 入口已保留，没有覆盖无限画布、短剧模板或后台代码。

## 校验哈希

- 备份 `index.html`：`5EA3AC2AADDB9891C55A54096B97BA95BE4BEE087B399EC5356D06FD0CA2606F`
- 合并后 `index.html`：`1BBA485F8733D1AAA19FE8ED86FA764BE9E84E3439E12DB4F591C4710D2BE8B0`
- `display-preferences.js`：`E83E4B1BA0B8252EC9F07BD9DDE25CB1E711E18A09078C045052C544F044A3B2`
- `appearance.css`：`74812E2135B1CB17C07722AC022B5CAAEA9654AA432ED1418091398972435592`

## 测试结果

- 发布包静态测试：18/18 通过，包含无限画布入口保护检查
- 主线真实 Electron 测试：12/12 通过
- 字号实测：13.16px / 14px / 15.68px / 17.36px
- 特大字体无横向溢出：首页、素材中心、文本创作、任务中心、无限画布、短剧模板、系统设置
- 左右侧栏静态测试：23/23 通过
- 左右侧栏实际交互：14/14 通过
- 全量回归：24/26 通过

全量回归的两项失败均位于豆包后台执行链路的旧字符串断言：

1. `monitor does not resend prompt`
2. `initial execute does not wait for completed video`

本次没有修改 `src/main`、数据库、任务执行、豆包控制器或相关测试。按照 UI 支线边界，没有为了全绿擅自修改后台。

## 回滚

1. 使用备份中的 `src/renderer/index.html` 覆盖主线同名文件。
2. 删除本次新增的 `src/renderer/display-preferences.js`。
3. 删除本次新增的 `src/renderer/styles/appearance.css`。

