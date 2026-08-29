# 无限画布窗口自适应与侧栏字号联动

- 发布标识：`infinite-canvas-responsive-font-v1.0.2-20260814-200500`
- 发布日期：2026-08-14
- 适用主线：`D:\project_v1\lingzhen_ai_desktop_v1`

## 修改内容

1. 移除无限画布舞台的 `770px` 最大高度限制。
2. 画布舞台改为占满主工作区剩余高度，主窗口放大或缩小时同步变化。
3. 画布底部始终贴合工作区，保留 12px 页面内边距，不再出现大块空白。
4. 左侧节点库与右侧检查器文字跟随系统“标准 / 大号 / 特大”字号。
5. 画布节点、连线、坐标、缩放和命令区保持原始尺寸，避免流程布局被字号设置挤乱。

## 修改文件

- `src/renderer/styles/infinite-canvas.css`
- `src/renderer/styles/appearance.css`

未修改后台、数据库、任务链路、模型网关、豆包控制器或无限画布执行逻辑。

## 主线文件哈希

- `infinite-canvas.css`：`B574AFE0AF70E7A8B1A04BDD3E406EEF42D9643A50AB0A28AA04C0D7A7FB9FAB`
- `appearance.css`：`B3497B292A011F3967E3D4E06269F6D16E97AE87F263CF440754ADF606DFA7AD`

## 验证结果

- 修改前窗口/字号专项测试：2/5，通过；3项准确复现失败。
- 修改后窗口/字号专项测试：5/5。
- 外观与模块隔离 Electron 实测：9/9。
- 无限画布综合回归：20/20。
- 无限画布 UX：19/19。
- 左右侧栏静态回归：23/23。
- 左右侧栏 Electron 实测：14/14。

专项实测中，窗口高度增加 300px 时画布高度同步增加 300px；大窗口底部空白由约 142px 降为固定 12px 页面内边距；特大字号下两侧栏文字为标准字号的 1.24 倍，画布节点字号保持稳定。

## 包内证据

- 修改前专项日志：`scripts/log/infinite-canvas-responsive-runtime-before.json`
- 主线修改后专项日志：`scripts/log/infinite-canvas-responsive-runtime.json`
- 主线外观隔离日志：`scripts/log/appearance-module-isolation-runtime.json`
- 最大化与特大字号截图：`scripts/log/infinite-canvas-responsive-xlarge.png`

## 回滚

原始主线文件已备份至：

`D:\project_v1\lingzhen_ai_desktop_v1\backups\infinite-canvas-responsive-font-v1.0.2-20260814-200500\src\renderer\styles`

如需回滚，关闭桌面客户端后，将备份目录中的两个 CSS 文件覆盖回主线同名路径即可。回滚不涉及数据库或后台服务。
