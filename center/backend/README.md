# lingzhen_center_backend

灵帧联网中心后端服务。当前已实现用户注册登录、租户 Membership、设备与 Session、JWT Access Token、Refresh Token 轮换、终端隔离和 RBAC 权限计算。新平台不再实现密钥认证。

## 技术基线

- Java 21 LTS
- Spring Boot 4.0.8
- Spring Security
- Spring Data JPA
- PostgreSQL 16，固定宿主机端口 `5433`
- HTTP API 固定端口 `9001`
- Maven Wrapper

## 配置

数据库密码和 HMAC Secret 不得写入代码库。Windows 开发/部署环境统一使用 DPAPI 运行配置：

| 环境变量 | 默认值 | 必填 |
| --- | --- | --- |
| `APP_DB_PASSWORD` | 无 | 是，仅由受保护启动脚本注入 Java 子进程 |
| `APP_AUTH_HMAC_SECRET` | 无 | 是，仅由受保护启动脚本注入 Java 子进程，至少 32 字节 |

数据库地址永久固定为 `jdbc:postgresql://127.0.0.1:5433/lingframe_identity`，应用角色永久固定为 `lingframe_app`。两者不能通过环境变量或启动参数覆盖。

首次配置时运行：

```powershell
.\scripts\initialize-runtime-secrets.ps1
```

脚本优先读取当前进程的 `APP_DB_PASSWORD`，其次读取项目父目录中本地忽略的 `.env.postgres`，最后尝试从本机 PostgreSQL 容器读取 `APP_DB_PASSWORD`。HMAC Secret 使用 64 字节安全随机数生成。两项 Secret 均由 Windows DPAPI 以当前用户作用域加密，保存到：

```text
%LOCALAPPDATA%\LingZhenAI\center-backend\runtime-secrets.json
```

该目录和文件关闭继承 ACL，仅当前 Windows 用户可访问。源码、桌面端、普通日志和命令行参数均不保存 Secret 明文。

启动、停止和验证：

```powershell
.\scripts\start-backend.ps1 -Build -ReplaceExisting
.\scripts\test-runtime-configuration.ps1
.\scripts\stop-backend.ps1
```

日常重启不需要重新初始化。只有数据库应用角色密码实际变化时才运行 `-RefreshDatabasePassword`；主动轮换 HMAC 会立即使旧 Access Token 失效，应只在明确的维护窗口运行 `-RotateHmacSecret`。

## 常用命令

```powershell
.\mvnw.cmd test
.\mvnw.cmd verify
.\scripts\test-database-migrations.ps1
.\scripts\test-wave5-credit-contract.ps1
.\scripts\test-billing-migration.ps1
.\scripts\test-regression-baseline.ps1 -DesktopRoot <桌面端项目绝对路径>
.\scripts\start-backend.ps1 -Build -ReplaceExisting
```

启动后验证：

- `GET http://127.0.0.1:9001/health/live`：进程存活，不依赖数据库。
- `GET http://127.0.0.1:9001/health/ready`：执行 `SELECT 1` 验证数据库连接。
- `GET http://127.0.0.1:9001/v3/api-docs`：OpenAPI JSON。
- `GET http://127.0.0.1:9001/swagger-ui.html`：Swagger UI。

任何试图修改 `server.port`、数据库地址或数据库应用角色的配置，都会在 Web 服务监听前终止启动。

## 分层架构

```text
controller/          控制层：HTTP 参数、状态码和响应组装
service/             业务接口层
service/impl/        业务实现和事务边界
repository/          数据访问层：JPA、JdbcTemplate 和 SQL
model/entity/        数据库实体
model/dto/           请求、响应和跨层数据模型
model/enums/         业务枚举
security/            JWT、密码、Cookie 和 Spring Security 适配
config/              应用配置
exception/           统一业务异常和 HTTP 错误映射
util/                无状态工具
```

强制规则：Controller 不得引用 Repository、Entity 或 `service.impl`；数据层不得反向依赖控制层和业务层；事务放在 `service.impl`。`LayerDependencyTest` 使用 ArchUnit 在每次构建时阻止违反分层的代码进入主线。

## 认证接口

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/select-tenant`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`

桌面端和管理中心的 Session 按 `client_type` 强隔离；桌面 Token 调用管理接口固定返回 403。管理中心 Refresh Token 使用 HttpOnly Cookie，同时校验双提交 CSRF Token。

## 本人积分与充值接口

- `GET /api/v1/credits/wallet`：返回当前登录用户的全局个人钱包，不按租户拆分。
- `GET /api/v1/credits/ledger?limit=20&cursor=...`：按 `created_at DESC, id DESC` 游标分页返回本人积分流水，单页最多 100 条。
- `GET /api/v1/recharge-packages`：返回当前可用的服务端充值套餐；金额、基础积分和赠送积分均以后端为准。
- `POST /api/v1/recharge-orders`：按套餐和渠道创建本人订单，要求 `Idempotency-Key`，重复请求返回原订单。
- `GET /api/v1/recharge-orders/{orderId}`：只允许查询当前登录用户自己的充值订单。

钱包和流水只允许 desktop 终端并要求 `credits.self.read`；充值套餐和订单只允许 desktop 终端并要求 `credits.self.recharge`。Bootstrap 已切换到同一全局钱包服务并继续保持 `schemaVersion=1`；账务数据库故障只降级积分区，非法在线余额会显式报错。

## 管理端账务与充值接口

- `GET /api/v1/management/credits/wallets`：按用户状态、用户名、邮箱或用户 ID 查询全局钱包。
- `GET /api/v1/management/credits/orders`：按订单状态、订单号或用户查询充值订单，不返回渠道私有单号和幂等键。
- `GET /api/v1/management/credits/ledger`：按流水类型、用户或业务标识查询不可变积分流水。
- `GET /api/v1/management/credits/reservations/anomalies`：查询已过期或连续 2 小时未更新的 `reserved` 预占。
- `GET/POST /api/v1/management/credits/packages`：查询或新建充值套餐；新套餐默认保存为草稿。
- `PUT /api/v1/management/credits/packages/{packageId}`：携带 `rowVersion` 编辑、启用或停用套餐，冲突返回 409。
- `POST /api/v1/management/credits/sandbox/orders/{orderId}/events`：仅在管理测试边界模拟支付成功、失败或用户取消。

以上接口只允许 `management_web + credits.manage`，写操作同时要求 CSRF。四个审计列表统一使用最大 100 条的稳定游标分页；管理中心 `/credits` 已提供钱包、充值订单、充值套餐、积分流水和异常预占五个页签。Sandbox 不连接微信、支付宝或任何真实资金渠道；桌面端不展示管理入口。

## 当前边界

- V2—V6 迁移链已应用到固定 `5433` 正式数据库；V7 `billing` 与 V8 受控充值命令迁移已通过隔离 PostgreSQL 验证但尚未应用正式库。普通 HTTP 启动继续关闭 Flyway，后续迁移仍只允许独立维护流程执行。
- 用户注册、登录、租户选择、Membership、RBAC、设备和会话业务接口已完成，并通过真实 PostgreSQL 集成测试。
- Windows 运行 Secret 已使用 DPAPI 固化到源码目录之外，服务重启不再依赖临时 PowerShell 环境变量。
- `/api/v1/activate`、`/api/v1/verify` 及等价密钥接口明确不属于新平台实现范围。
- `/api/v1/desktop/bootstrap`、模型目录、Workspace Snapshot、豆包账号摘要、全局个人钱包、本人积分流水、充值套餐、本人充值订单、Sandbox 支付适配和管理端账务 API/UI 已完成。真实支付渠道、预占结算业务层、Skill 执行包和创作记忆学习仍属于后续节点。

数据库模型与迁移说明见 [src/main/resources/db/migration/README.md](src/main/resources/db/migration/README.md)。
