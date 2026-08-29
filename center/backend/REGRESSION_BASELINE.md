# 运行配置改造回归基线

本基线用于约束 Windows DPAPI 运行配置改造。改造只允许改变 Secret 的保存和 Java 进程启动方式，不得改变已有业务能力。

## 不允许变化的功能

- HTTP 端口固定为 `9001`，数据库固定为 `127.0.0.1:5433/lingframe_identity`。
- HTTP 服务数据库角色固定为 `lingframe_app`，Flyway 在普通启动中保持关闭。
- 注册、登录、选择租户、刷新 Token、退出登录和 `me` 接口契约不变。
- Controller、Service、Data/Repository 分层和 ArchUnit 约束不变。
- 桌面端仍通过 HTTP API 调用身份服务，不读取数据库地址、用户、密码或 HMAC Secret。
- 桌面端 Token 仍仅由 Electron 主进程加密保存，渲染层不得获取 Token。

## 改造前基线（2026-08-25）

| 验证项 | 结果 |
| --- | --- |
| Spring Boot 测试 | 26/26 通过 |
| 桌面认证测试 | 9/9 通过 |
| 桌面烟测 | 17/17 通过 |
| `/health/live` | `UP` |
| `/health/ready` | `UP` |

## 交付门禁

改造后必须再次运行同一组测试，并额外满足：

1. 使用加密运行配置连续启动两次，两个周期的 `live/ready` 均为 `UP`。
2. 匿名访问受保护身份接口仍返回 `401`，错误登录仍返回 `401`。
3. 源码、运行配置和日志中不存在数据库密码、HMAC Secret 或 Token 明文。
4. 任一原基线失败时，停止交付并恢复到改造前启动方式。

统一执行命令：

```powershell
.\scripts\test-regression-baseline.ps1 -DesktopRoot <桌面端项目绝对路径>
```
