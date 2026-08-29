# 身份、权限、模型目录、桌面数据与积分账务数据库迁移设计

## 1. 设计目标

本迁移链为桌面端和 Web 管理中心提供统一的用户身份、租户 Membership、RBAC、设备、Session、一次性票据和功能策略。新平台只有一套准入来源：

```text
用户状态
AND 租户状态
AND Membership 状态
AND 设备状态
AND Session.client_type 接口域
AND 角色 permission
AND permission override / feature policy
```

积分只控制平台付费模型调用，不控制登录。图片、视频、豆包 Cookie、Chrome Profile、模型密钥、支付密钥和 Skill 签名私钥不进入 identity schema。

## 2. 迁移链

| 版本 | 文件 | 内容 |
| --- | --- | --- |
| V1 | `database/init/002-bootstrap.sql` | 外部基线：数据库、角色、schema 和基础元数据 |
| V2 | `V2__create_identity_tables.sql` | 用户、租户、角色、权限、Membership、平台角色分配、设备、Session、Refresh Token |
| V3 | `V3__create_access_control_tables.sql` | 租户邀请、租户选择票据、permission override、feature policy |
| V4 | `V4__seed_identity_rbac_catalog.sql` | 六个系统角色、41 个按终端分域的 permission 及角色映射 |
| V5 | `V5__create_model_catalog_tables.sql` | 独立 `model_catalog` schema、平台模型草稿、不可变发布快照和租户模型策略 |
| V6 | `V6__create_desktop_workspace_tables.sql` | 独立 `desktop_data` schema、Workspace Snapshot、豆包账号摘要、旧基础积分账户和 Skill 摘要 |
| V7 | `V7__create_billing_tables.sql` | 独立 `billing` schema、全局个人钱包、充值订单、追加式账本、价格版本和任务计费记录 |

普通应用启动继续保持 `spring.flyway.enabled=false`。V2—V6 已在备份和维护窗口内应用固定 `5433` 正式数据库；V7 当前只在不映射宿主机端口的隔离 PostgreSQL 16 中验证，尚未应用正式数据库。

## 3. 关系与作用域

```text
users ──< tenant_memberships >── tenants
  │              │                  ├──< tenant_invitations
  │              │                  ├──< devices
  │              │                  ├──< permission_overrides
  │              │                  └──< feature_policies
  │              └──< user_sessions ──< refresh_tokens
  │
  ├──< platform_role_assignments >── roles(scope=platform)
  └──< tenant_selection_tickets ──< ticket_memberships >── tenant_memberships

tenant_memberships >── roles(scope=tenant)
roles ──< role_permissions >── permissions(client_type)

model_catalog.providers ──< model_catalog.models
                                  ├──< model_catalog.catalog_version_items >── model_catalog.catalog_versions
                                  └──< model_catalog.tenant_models >── identity.tenants
                                                                       └── updated_by_membership_id

identity.users ──< desktop_data.workspace_snapshots >── identity.tenants
       │          ├──< desktop_data.doubao_account_bindings
       │          └──< desktop_data.credit_accounts（V7 兼容迁移源）
       │
       └── billing.user_wallets
                ├──< billing.recharge_orders >── billing.recharge_packages
                ├──< billing.credit_ledger_entries
                └──< billing.credit_reservations ──< billing.credit_settlements
                                      │
                                      └── billing.model_price_versions >── model_catalog.models
```

### 3.1 角色作用域硬隔离

- `platform_admin` 是 `role_scope=platform`，只能写入 `platform_role_assignments`。
- `owner/admin/operator/viewer/member` 是 `role_scope=tenant`，只能写入 `tenant_memberships`。
- 两个分配表都使用 `(role_id, role_scope)` 复合外键，数据库直接拒绝跨作用域角色。
- 平台管理员仍需先建立一个有效租户 Session；全局权限只在 `management_web` 请求中与当前 Membership 权限合并。

### 3.2 终端硬隔离

- `devices.client_type` 和 `user_sessions.client_type` 只能为 `desktop` 或 `management_web`。
- Session 通过 `(device_id, tenant_id, client_type)` 复合外键绑定同租户、同终端类型设备。
- Session 通过 `(membership_id, tenant_id, user_id)` 复合外键绑定同一个用户的当前租户 Membership。
- 即使账号拥有管理 permission，`client_type=desktop` 仍必须在 Spring Security 路由门禁处被管理 API 拒绝。
- `permissions.client_type` 负责目录分域；服务端执行顺序必须是先检查 Session client type，再计算 permission。

## 4. 核心表与不变量

| 表 | 核心职责 | 数据库不变量 |
| --- | --- | --- |
| `tenants` | 租户边界 | `tenant_code` 全局唯一；状态仅 active/suspended/closed |
| `users` | 全局登录身份 | 用户名、邮箱忽略大小写唯一；密码算法固定 Argon2id |
| `roles` | 系统角色目录 | code 唯一；scope 只能 platform/tenant |
| `permissions` | 权限目录 | code 唯一；权限只能属于 desktop/management_web 一个终端域 |
| `tenant_memberships` | 用户在租户内的单一角色 | `(tenant_id,user_id)` 唯一；只能引用 tenant 角色 |
| `platform_role_assignments` | 平台全局角色 | 只能引用 platform 角色；同一用户同一角色最多一个 active 分配 |
| `devices` | 租户内终端摘要 | `(tenant_id,client_type,device_hash)` 唯一；不绑定单个用户 |
| `user_sessions` | 正式登录会话 | 用户、Membership、设备、租户、client_type 必须组成一致上下文 |
| `refresh_tokens` | Token 轮换链 | 只存 32 字节哈希；每个 Session 最多一个 active Token；父子必须同 family |
| `tenant_invitations` | 租户邀请 | 只存 32 字节票据哈希；角色必须是 tenant；状态字段与时间字段一致 |
| `tenant_selection_tickets` | 两阶段登录票据 | 只存 32 字节哈希；绑定用户、设备摘要、终端类型和短有效期 |
| `tenant_selection_ticket_memberships` | 候选租户白名单 | 候选 Membership 必须属于票据用户；同一票据同一租户只能出现一次 |
| `permission_overrides` | 显式 permission allow/deny | target 为 tenant 或 Membership；Membership、操作者必须同租户 |
| `feature_policies` | 功能启停和参数策略 | target 为 tenant 或 Membership；policy 必须是 JSON object |
| `model_catalog.providers` | 平台厂商非敏感目录 | code 全局唯一；协议、状态受白名单约束；active 模型存在时厂商不可停用 |
| `model_catalog.models` | 平台模型草稿 | 厂商内 model code 唯一；参数 Schema/默认参数必须为 JSON object；新增默认不向租户启用 |
| `model_catalog.catalog_versions` | 发布版本头 | version/idempotency 唯一；最多一个 current；必须在同事务内封存且至少有一条快照 |
| `model_catalog.catalog_version_items` | 不可变发布快照 | 封存后禁止 INSERT/UPDATE/DELETE；同版本 model 和 provider+model code 唯一 |
| `model_catalog.tenant_models` | 租户模型策略 | policy 仅 inherit/enabled/hidden；操作者 Membership 必须与 tenant_id 同租户 |
| `desktop_data.credit_accounts` | V6 旧基础积分账户 | 按 tenant+user 隔离；V7 后仅作为兼容迁移源，不作为账务真相源 |
| `billing.user_wallets` | 全局个人钱包快照 | `user_id` 主键；不含 tenant_id；可用和预占余额均不得为负 |
| `billing.recharge_packages` | 充值套餐 | 金额使用分；积分使用整数；套餐 code 唯一 |
| `billing.recharge_orders` | 充值订单 | 订单号唯一；user+幂等键唯一；渠道流水在渠道内唯一 |
| `billing.credit_ledger_entries` | 追加式积分账本 | 余额变化后值非负；业务类型+幂等键唯一；触发器拒绝 UPDATE/DELETE |
| `billing.model_price_versions` | 模型价格版本 | model+version 唯一；每个模型最多一个 active 版本 |
| `billing.credit_reservations` | 任务积分预占 | task+attempt 唯一；settled+released 不超过 reserved |
| `billing.credit_settlements` | 成功结算事实 | reservation、task 和幂等键分别唯一；触发器拒绝 UPDATE/DELETE |

## 5. 状态机

- 用户：`pending → active ↔ locked → disabled`。
- 租户：`active → suspended → closed`。
- Membership：`invited → active ↔ suspended → removed`。
- 平台角色分配：`active → revoked`。
- 邀请：`pending → accepted/expired/revoked`。
- 设备：`unknown ↔ trusted → blocked`。
- Session：`active → revoked`，时间过期由查询条件判断。
- Refresh Token：`active → rotated/revoked → reused`。
- 租户选择票据：`pending → consumed/revoked`，过期由查询条件判断。
- override/policy：`active → revoked`。
- 充值订单：`pending → paid/closed`，`paid → refund_pending → refunded`，异常退款进入 `manual_review`。
- 价格版本：`draft → active → retired`。
- 积分预占：`reserved → settled/released`，结算退款后进入 `refunded`；提交未知时保持 `reserved`。

用户禁用、租户关闭、Membership 移除、设备阻止或 Refresh Token 重放时，应用层必须在事务中撤销相关 Session。角色、override 和 policy 变化不删除 Session，但下一次权限计算必须立即读取新结果。

## 6. RBAC 目录

### 6.1 系统角色

| 角色 | scope | 终端能力 |
| --- | --- | --- |
| `platform_admin` | platform | 管理中心全部平台和租户管理 permission；不直接获得桌面权限 |
| `owner` | tenant | 全部桌面使用权限 + 租户最高管理权限 |
| `admin` | tenant | 全部桌面使用权限 + 常规租户管理权限，不可关闭租户 |
| `operator` | tenant | 全部桌面使用权限 + 部分运营管理权限 |
| `viewer` | tenant | 管理中心只读权限，不含桌面创作权限 |
| `member` | tenant | 全部桌面使用权限，不含管理权限 |

### 6.2 权限分域

桌面权限包括 `desktop.bootstrap`、项目/素材/任务/创作/模型/Skill/豆包账号使用、本人积分和同步。管理权限包括租户、Membership、角色、权限策略、设备、Session、租户模型/Skill、审计、全局用户、积分、平台模型目录、平台 Skill 和系统管理。

`desktop/bootstrap` 只能返回 `client_type=desktop` 的有效权限白名单，不能返回任何管理 permission。

### 6.3 模型目录发布不变量

- `providers/models` 是可维护草稿，已发布桌面目录只读取 `catalog_version_items`，草稿变化不会直接影响桌面端。
- 发布事务先创建 `catalog_versions(published_at=NULL)`，写入完整快照，再设置 `published_at` 封存并切换 `is_current`。
- 延迟约束触发器在事务结束前验证版本已封存且至少包含一条快照；未完成版本不能提交。
- 快照封存后，数据库触发器拒绝追加、修改和删除；发布版本除 `is_current` 外不可修改，也不可硬删除。
- active 模型必须引用 active 厂商；已存在 active 模型时厂商不能改为 draft/inactive。
- `lingframe_app` 只能更新发布版本的 `published_at/is_current` 两列，对快照只有 SELECT/INSERT，无 UPDATE/DELETE。

## 7. 权限计算顺序

1. 校验用户、租户、Membership、设备和 Session 状态及有效期。
2. 校验请求接口域与 `Session.client_type` 是否一致；不一致直接 403。
3. 读取 Membership tenant role；仅管理中心请求再合并 active 平台角色。
4. 只保留与当前 client type 相同的 role permissions。
5. 应用有效期内的 permission overrides；同一 permission 出现 deny 时 deny 优先。
6. 应用 feature policies；平台安全禁用优先于租户/成员 enable。
7. 对平台付费模型调用额外校验积分和模型策略。

## 8. 并发与幂等

- 注册时用户、个人租户和 owner Membership 必须在同一事务创建。
- 邀请接受必须锁定邀请，验证状态/有效期/目标账号后原子创建或复用 Membership。
- 租户选择票据消费必须锁定票据，只能选择白名单中的 active Membership，并原子创建设备、Session 和首个 Refresh Token。
- Refresh Token 轮换必须锁定旧 Token；重复使用旧 Token 时撤销 family 和 Session。
- 邀请、override 和 policy 提供租户内 `idempotency_key` 唯一约束。
- 可更新聚合包含 `row_version`，JPA 使用乐观锁。
- V7 合并旧租户级积分时，同一用户多个相同余额只迁移一次且不求和；出现不同余额时整个迁移失败。
- V7 为 `identity.users` 建立 AFTER INSERT 钱包供应触发器，新注册用户在身份事务内自动获得零余额全局钱包。
- 充值订单以 `user_id + idempotency_key` 防重复创建，渠道流水以 `payment_channel + channel_trade_no` 防重复入账。
- 模型任务以 user+clientRequestId、task+attempt 和 task settlement 三层唯一约束防止重复预占与重复结算。
- 上游提交状态未知时保持预占，不自动重发、结算或释放。

## 9. 权限与数据安全

- 迁移只能由 `lingframe_owner` 执行；HTTP 服务只能使用 `lingframe_app`。
- `lingframe_app` 对 RBAC 目录只读，对身份、模型草稿和租户策略表只有需要的 SELECT/INSERT/UPDATE，没有 DDL 和硬 DELETE。
- `model_catalog` schema 由 `lingframe_owner` 独立拥有；应用角色只有 USAGE，不能创建对象或修改封存快照。
- `billing` schema 由 `lingframe_owner` 独立拥有；V7 初始仅向 `lingframe_app` 授予 SELECT，应用角色不能直接 UPDATE 钱包或写入/修改/删除账本，也不能直接执行 SECURITY DEFINER 钱包供应函数。
- Token 和邀请票据只保存 32 字节哈希；设备只保存版本化摘要。
- 首期不启用 PostgreSQL RLS；Repository 必须显式带 `tenant_id`，跨租户负例由集成测试覆盖。
- 旧认证 JSON、密钥、激活记录、Grant 和租约不导入任何新表。

## 10. 回滚与验证

回滚顺序固定为：

1. `U7__drop_billing_tables.sql`
2. `U6__drop_desktop_workspace_tables.sql`
3. `U5__drop_model_catalog_tables.sql`
4. `U4__remove_identity_rbac_catalog.sql`
5. `U3__drop_access_control_tables.sql`
6. `U2__drop_identity_tables.sql`

`scripts/test-database-migrations.ps1` 继续验证 V2—V5 身份和模型目录基线。`scripts/test-billing-migration.ps1` 使用不映射宿主机端口的临时 PostgreSQL 16 容器执行 V2—V7、旧余额迁移、冲突负例、Ground Truth、账本不可变、最小权限、U7 单独回滚和 V7 再次应用。正式库只在独立备份和维护窗口后迁移。
