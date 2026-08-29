# 身份与权限数据库迁移

本目录保存已重写的 Flyway 身份与权限迁移链。新平台使用用户、租户 Membership、设备、Session、RBAC 和功能策略作为唯一准入体系，不创建旧密钥认证业务。

## 迁移顺序

| 版本 | 文件 | 内容 |
| --- | --- | --- |
| 1 | 外部基线 | `database/init/002-bootstrap.sql` 创建 schema、数据库角色和基础元数据 |
| 2 | `V2__create_identity_tables.sql` | 核心身份、RBAC、Membership、平台角色、设备、会话和 Refresh Token |
| 3 | `V3__create_access_control_tables.sql` | 邀请、租户选择票据、权限覆盖和功能策略 |
| 4 | `V4__seed_identity_rbac_catalog.sql` | `platform_admin/owner/admin/operator/viewer/member` 和终端分域权限目录 |
| 5 | `V5__create_model_catalog_tables.sql` | 独立模型目录、草稿、不可变发布版本快照和租户模型策略 |
| 6 | `V6__create_desktop_workspace_tables.sql` | 桌面 Workspace Snapshot、豆包账号摘要、基础积分账户和已发布 Skill 元数据 |
| 7 | `V7__create_billing_tables.sql` | 全局个人钱包、充值套餐/订单、追加式账本、模型价格版本和任务积分预占/结算 |

正式数据库是非空 V1 基线。普通应用启动继续保持 `spring.flyway.enabled=false`；不得让 HTTP 服务自动执行迁移。2026-08-25 已在完整备份和停机维护窗口内按 V5 → V6 应用到固定 `5433`；V7 当前只完成隔离验证，正式应用仍必须另行备份和安排维护窗口。

## 固定运行边界

- PostgreSQL 正式地址固定 `127.0.0.1:5433/lingframe_identity`。
- Spring Boot API 固定端口 `9001`。
- 迁移身份固定 `lingframe_owner`，HTTP 应用身份固定 `lingframe_app`。
- 桌面端禁止直连 PostgreSQL。
- 数据库密码、Token、设备原始证据和服务端调用密钥不得写入迁移或版本库。

## 回滚

Flyway Community 不会自动执行 `db/rollback` 中的 U 文件。隔离环境的逆序回滚为：

1. `U7__drop_billing_tables.sql`
2. `U6__drop_desktop_workspace_tables.sql`
3. `U5__drop_model_catalog_tables.sql`
4. `U4__remove_identity_rbac_catalog.sql`
5. `U3__drop_access_control_tables.sql`
6. `U2__drop_identity_tables.sql`

回滚会删除 identity 业务表和数据。正式环境只有在可恢复备份、明确维护窗口和应用停写后才能执行。

## 隔离验证

在后端项目目录运行：

```powershell
.\scripts\test-database-migrations.ps1
.\scripts\test-wave5-credit-contract.ps1
.\scripts\test-billing-migration.ps1
```

测试容器不映射宿主机端口，不连接固定 `5433` 正式数据库。模型目录脚本验证 V2—V5 基线；账务脚本验证 V2—V7 完整依赖链。合计覆盖：

- V2-V6 正向迁移、有效文件命名和 Ground Truth 表集合。
- 活跃迁移不含旧 licensing schema 或 `license.*` permission。
- 角色 scope、跨租户复合外键、Session client type 和两阶段登录票据约束。
- Refresh Token 哈希、单 active Token 和同 family 父子链约束。
- member/viewer/platform_admin 权限终端分域。
- 模型 JSON object、状态、能力、唯一键、单 current 版本和 active 厂商约束。
- 发布版本必须在同事务封存；封存快照禁止追加、修改和删除。
- `tenant_models.updated_by_membership_id + tenant_id` 跨租户写入被拒绝。
- `lingframe_app` 无 DDL、RBAC 写入、身份硬删除和快照 UPDATE/DELETE 权限。
- `lingframe_app` 对积分账户只有 SELECT、INSERT，不允许直接 UPDATE 余额。
- 同一用户在多个租户的相同旧余额只迁移一次，不求和；不同余额使 V7 原子失败。
- V7 为 `identity.users` 安装受保护的 AFTER INSERT 触发器，新注册用户自动获得零余额全局钱包；`lingframe_app` 无权直接执行触发器函数。
- `billing.credit_ledger_entries` 和 `credit_settlements` 禁止 UPDATE/DELETE。
- `lingframe_app` 对 V7 账务表初始只有 SELECT，不能直接 UPDATE 钱包或 INSERT/UPDATE/DELETE 账本。
- U7 单独回滚保留 V2—V6 和旧积分账户；修复冲突后 V7 可再次应用。
- 测试日志写入 `scripts/log/database-migrations-*.log`、`wave5-credit-contract-*.log` 和 `billing-migration-*.log`。

## 当前不包含

- 真实用户、管理员、租户和平台角色分配数据。
- 旧认证 JSON 中的任何密钥、激活、Grant 或租约数据。
- 真实支付渠道、商户验签、账务写入函数、充值 API、预占/结算 Service 和自动对账任务；V7 当前只建立受保护的数据基础。
- Skill 执行包、后台上传发布流程和桌面端执行沙箱；V6 只保存 Bootstrap 可见元数据。
- 本地素材二进制跨设备同步；Workspace Snapshot 只保存脱敏元数据。
