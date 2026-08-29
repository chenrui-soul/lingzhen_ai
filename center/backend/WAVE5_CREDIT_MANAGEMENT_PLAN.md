# Wave 5：积分管理完整闭环

## 0. 规划状态

- **状态**：节点 5.0—5.4 已完成并验收；下一步进入节点 5.5 模型价格版本发布。
- **推荐执行模块**：个人积分钱包、充值订单、追加式账本、模型价格版本、任务预占/结算/释放、管理端账务审计。
- **依赖基线**：Wave 4 正式部署完成；统一身份、RBAC、模型目录、桌面 bootstrap、Workspace 联网保持通过。
- **固定端口**：Spring Boot `9001`；PostgreSQL `127.0.0.1:5433/lingframe_identity`。
- **正式库边界**：普通 HTTP 启动继续保持 `spring.flyway.enabled=false`；V7 必须先在隔离 PostgreSQL 16 完成正向、负向和回滚验证，正式 `5433` 不在本 Wave 自动迁移。

> 历史路线曾把积分模块标记为 Wave 4。实际 Wave 4 已用于桌面身份续期和联网数据，因此积分闭环从本文件起统一称为 Wave 5；不回写或重命名既有 Wave 4 发布记录。

## 1. 项目启动信息

- **项目类型**：Spring Boot 模块化单体后台业务模块 + PostgreSQL 账务域 + Vue 3 管理中心 + Electron 桌面兼容联通。
- **业务目标**：用户可查看和充值个人积分；平台模型任务提交前预占积分，成功后结算，明确失败或取消后释放；管理员只能通过审计化业务动作调整积分。
- **终极功能**：任意充值、并发模型任务、重复回调、失败重试和人工调整都不能造成重复入账、重复扣费、负余额或无流水余额变化。
- **技术栈**：Java 21、Spring Boot 4、Spring Security、JDBC、PostgreSQL 16、Flyway、Vue 3、Electron。
- **默认循环轮次**：3。
- **安全最大轮次**：6。
- **每轮最大改动点数**：3 个原子任务。

## 2. Proposal

- **Intent**：把 Wave 4 的只读基础积分余额升级为可充值、可审计、可预占和可结算的真实账务闭环，为平台模型调用提供可靠计费前置。
- **Scope**：In scope 为个人钱包、套餐/订单、追加式流水、价格版本、预占/结算/释放、本人查询和管理端审计；Out of scope 为未确定支付渠道的真实签名算法、企业租户钱包、豆包账号渠道收费和平台模型供应商真实代理。
- **Approach**：新增独立 `billing` schema，以用户钱包为聚合根、追加式账本为审计真相源；所有余额变化由事务化业务命令完成，桌面端继续通过 9001 API 使用兼容的 bootstrap 契约。

## 3. 节点 5.0 现状审计

| 审计项 | 当前实现 | 目标契约 | 处理结论 |
| --- | --- | --- | --- |
| 钱包归属 | `desktop_data.credit_accounts` 按 `tenant_id + user_id` 唯一 | 首期每个用户一个全局个人钱包 | 新建 `billing.user_wallets(user_id PK)`；旧表保留作过渡，不直接删除 |
| 余额字段 | 只有 `balance` | 可用余额 + 预占余额 + 版本 | 新钱包使用 `available_balance`、`reserved_balance`、`row_version` |
| 审计来源 | 无积分流水 | 所有余额变化必须有追加式流水 | 新建不可 UPDATE/DELETE 的 `credit_ledger_entries` |
| 充值 | 已完成套餐、本人订单和 Sandbox 状态闭环 | 套餐以后端为准，订单和支付事件双重幂等 | 真实渠道适配继续等待支付渠道、商户配置和验签规范 |
| 模型价格 | 模型目录无价格表 | 任务固定提交时价格版本 | 新建不可复用覆盖的 `model_price_versions` |
| 任务计费 | 无预占和结算 | 提交前预占，成功结算，失败释放，未知保持预占 | 新建 reservation/settlement，后续接入任务服务 |
| 桌面契约 | `schemaVersion=1`，`credits.available/balance` | 旧客户端继续可用 | 保持原字段和版本；后续新增字段只能是可选字段 |
| 数据库权限 | V7 账务表只授予应用角色 SELECT | 应用角色不能直接改余额或账本 | V8 仅授予五个 SECURITY DEFINER 命令函数执行权，普通表写权限不放开 |

### 3.1 关键兼容结论

1. `DesktopBootstrapResponse.CreditSummary(boolean available, long balance)` 和桌面 `validateDesktopBootstrap()` 当前只要求非负安全整数，可继续返回全局个人钱包的可用余额，不需要提升 `schemaVersion`。
2. 租户切换后 `credits.balance` 必须保持同一用户全局余额，不能再从租户级旧表分别读取。
3. `credits.available=false` 仍表示当前会话没有 `credits.self.read` 或账务子系统不可用，不代表余额为零。
4. 旧 `desktop_data.credit_accounts` 在后端切换到 `BillingWalletService` 前保留；完成双读校验后再单独规划移除，V7 不做 DROP/RENAME。
5. 平台模型在价格、预占、结算和真实代理全部完成前继续保持 `executionReady=false`。

## 4. 范围

### 4.1 In scope

- 每个用户一个全局个人钱包，积分使用 `bigint` 整数最小单位。
- 充值套餐、充值订单、支付状态、渠道流水和订单幂等。
- 不可覆盖的积分账本及充值、预占、结算、释放、退款、迁移和人工调整条目。
- 模型价格版本与任务提交时价格快照。
- 同一任务/attempt 的积分预占、成功结算、明确失败释放和未知状态保持。
- 本人钱包/流水/订单查询 API。
- 管理端钱包、流水、订单查询和人工调整审计 API/UI。
- Bootstrap 全局钱包兼容、旧桌面客户端回归和敏感字段扫描。

### 4.2 Out of scope

- 在支付渠道、商户号、签名算法和回调网络边界未确定前接入真实支付。
- 企业统一付费、租户钱包、共享额度、透支和授信。
- 豆包账号渠道或本地 BYOK 模型消耗平台积分。
- 平台模型真实凭据、供应商代理和任务回传实现。
- 用积分控制登录、租户 Membership、设备信任或基础桌面启动。
- 删除或覆盖历史积分流水。

## 5. 统一语言与限界上下文

| 术语 | 规范定义 |
| --- | --- |
| 用户钱包 | 以 `user_id` 唯一标识的全局个人积分聚合，不属于租户或设备 |
| 可用积分 | 可被新任务预占或用于退款扣回的余额 |
| 预占积分 | 已为任务锁定、暂未最终结算的余额 |
| 积分账本条目 | 已发生的不可变账务事实；只能追加冲正，不能原地修改或删除 |
| 价格版本 | 模型在某次发布后生效的不可变计价快照 |
| 积分预占 | 在调用上游前把积分从可用余额移动到预占余额的事务 |
| 积分结算 | 有效结果校验成功后从预占余额中确认消费的事务 |
| 积分释放 | 明确失败、提交前取消或无需消费时把预占返还可用余额的事务 |

限界上下文：

```text
identity  ──用户身份──> billing
model_catalog ──稳定 model_id──> billing.model_price_versions
creation/task ──task_id + attempt_id──> billing.credit_reservations
billing ──余额摘要/计费结果──> desktop bootstrap 与任务中心
payment adapter ──验签后的支付事实──> billing.recharge_orders
```

`billing` 持有钱包、订单、账本、价格和预占数据；其他模块只能通过 Service/API 契约调用，不得直接写账务表。

## 6. 领域事件与状态机

### 6.1 领域事件

- `WalletCreated`
- `RechargeOrderCreated`
- `RechargePaid`
- `CreditsReserved`
- `CreditsSettled`
- `CreditsReleased`
- `CreditsRefunded`
- `CreditsAdjusted`

### 6.2 充值订单状态

```text
pending ──支付成功──> paid
pending ──取消/超时──> closed
paid ──退款申请──> refund_pending ──退款完成──> refunded
refund_pending ──余额不足或渠道异常──> manual_review
```

### 6.3 积分预占状态

```text
reserved ──结果有效──> settled
reserved ──明确失败/提交前取消──> released
reserved ──提交状态未知──> reserved（保持，不自动重发）
settled ──退款/冲正──> refunded
```

禁止 `released → reserved` 和 `settled → released`。同一任务重试使用新的 attempt 记录，但一个任务最多只能产生一次成功结算。

## 7. V7 数据模型

V7 新建独立 `billing` schema，包含：

| 表 | 一致性职责 | 关键约束 |
| --- | --- | --- |
| `user_wallets` | 钱包余额快照 | `user_id` 主键；余额非负；无 `tenant_id` |
| `recharge_packages` | 服务端套餐 | 金额用分；积分为整数；代码唯一；乐观锁 |
| `recharge_orders` | 支付订单 | 订单号唯一；`user_id + idempotency_key` 唯一；渠道流水唯一 |
| `credit_ledger_entries` | 账务真相源 | 只追加；业务类型+幂等键唯一；变化后余额非负 |
| `model_price_versions` | 模型价格快照 | `model_id + version_no` 唯一；每模型最多一个 active |
| `credit_reservations` | 任务积分预占 | `task_id + attempt_id` 唯一；预占/结算/释放总量不超预占 |
| `credit_settlements` | 成功结算事实 | reservation 唯一；task 唯一；结算幂等键唯一 |

### 7.1 旧余额迁移规则

1. V7 执行前检查同一 `user_id` 在旧租户级账户中是否出现不同余额。
2. 同一用户旧余额一致时迁移为一个全局钱包；多个相同值不能相加，避免切换租户造成重复积分。
3. 同一用户旧余额冲突时 V7 整体失败并回滚，禁止静默选择、求和或覆盖。
4. 非零旧余额同时写入一条 `migration` 账本条目；零余额只创建钱包，不制造无意义流水。
5. V7 不修改、不删除 `desktop_data.credit_accounts`，便于应用回滚和双读核对。

## 8. 账务不变量

1. 每个用户最多一个个人钱包，钱包不包含 `tenant_id`。
2. `available_balance >= 0` 且 `reserved_balance >= 0`。
3. 余额变化必须与一条不可变账本条目处于同一事务。
4. 账本条目禁止 UPDATE/DELETE；纠错只能追加 reversal/refund/adjustment。
5. 同一业务类型和幂等键最多一条账本条目。
6. 客户端不能提交充值积分、赠送积分或人民币金额作为最终依据。
7. 同一用户和 `clientRequestId` 重复提交返回原任务与原计费上下文。
8. 同一 `taskId + attemptId` 最多一个积分预占。
9. 同一任务最多一个成功结算。
10. `settled_credits + released_credits <= reserved_credits`。
11. 余额不足时不创建上游平台任务。
12. 上游状态未知时保持预占，不自动重复发送或重复扣费。
13. 回传修复不会创建第二次结算。
14. 人工调整必须记录操作者、原因、幂等键和调整后余额。
15. `lingframe_app` 不直接 UPDATE 钱包或 INSERT/UPDATE/DELETE 账本。
16. 桌面端永远收不到支付密钥、平台模型凭据、内部路由或数据库信息。
17. 积分不足只影响需要平台积分的提交动作，不影响登录、豆包、本地 BYOK、项目、素材和任务历史。
18. Bootstrap `schemaVersion` 保持 1，旧客户端继续只读取 `credits.available/balance`。

## 9. API 行为契约

| 接口 | 终端/权限 | 关键行为 |
| --- | --- | --- |
| `GET /api/v1/credits/wallet` | desktop + `credits.self.read` | 只返回当前用户全局钱包 |
| `GET /api/v1/credits/ledger` | desktop + `credits.self.read` | 游标分页，只返回本人流水 |
| `GET /api/v1/recharge-packages` | desktop + `credits.self.recharge` | 只返回 active 套餐和服务端金额 |
| `POST /api/v1/recharge-orders` | desktop + `credits.self.recharge` | 要求 `Idempotency-Key`，请求只提交 packageId/channel |
| `GET /api/v1/recharge-orders/{orderId}` | desktop + `credits.self.recharge` | 订单必须属于当前用户 |
| `POST /api/v1/payment-callbacks/{channel}` | payment adapter | 不接受用户 Token 作为支付凭证；必须验签 |
| `GET /api/v1/management/credits/*` | management_web + `credits.manage` | 查询钱包、订单、流水和异常预占 |
| `POST /api/v1/management/credits/adjustments` | management_web + `credits.manage` | CSRF + Idempotency-Key + 原因；只能追加调整流水 |

统一错误码至少包含：`INSUFFICIENT_CREDITS`、`CREDIT_IDEMPOTENCY_CONFLICT`、`CREDIT_RESERVATION_NOT_FOUND`、`CREDIT_RESERVATION_STATE_CONFLICT`、`RECHARGE_ORDER_NOT_FOUND`、`RECHARGE_ORDER_STATE_CONFLICT`、`PAYMENT_CALLBACK_INVALID`、`PAYMENT_AMOUNT_MISMATCH`、`CREDIT_ADJUSTMENT_INVALID`。

## 10. 桌面兼容策略

1. 节点 5.2 将 `DesktopWorkspaceService` 中的旧租户积分读取替换为独立 `BillingWalletService`，Controller 不直接访问 Repository。
2. Bootstrap 继续输出：

   ```json
   {"credits":{"available":true,"balance":125}}
   ```

3. 后续可选增加 `reservedBalance`、`updatedAt` 和 `rechargeAvailable`，旧客户端必须忽略未知字段；节点 5.2 默认先不增加字段，缩小兼容半径。
4. 桌面缓存继续绑定 `userId + tenantId` 作为整份 bootstrap 身份边界，但切换租户后同一用户的积分数值必须一致。
5. 在线返回非法积分（负数、非安全整数、缺少必要对象）时必须显式失败，不得回退旧缓存掩盖契约错误。
6. 平台模型只有在价格版本、平台代理和账务闭环都可用时才允许 `executionReady=true`；本 Wave 前半段保持 false。

## 11. Wave 执行计划

### 节点 5.0：领域契约、状态机与兼容审计

- 产出本计划和 `references/credit_domain_ground_truth.json`。
- 验证旧租户账户冲突、权限目录、bootstrap schemaVersion 和桌面安全整数边界。
- 完成定义：所有 Requirement 有可测试 Scenario，18 条不变量进入 Ground Truth。

### 节点 5.1：V7 `billing` 隔离数据库迁移

- 新建 7 张账务表、账本不可变触发器、必要约束/索引和 U7 回滚。
- 迁移旧余额时遇到同用户不同余额必须整笔失败。
- `lingframe_app` 初始只读，不获得直接余额/账本写权限。
- 完成定义：PostgreSQL 16 隔离正向、冲突负例、U7、再次应用和最小权限全部通过；正式 5433 未连接。

### 节点 5.2：本人钱包只读 API 与 Bootstrap 切换

- 新增 Controller → Service → Repository 分层的本人钱包/流水查询。
- Bootstrap 改读全局钱包并保持 schemaVersion 1。
- 增加同用户跨租户余额一致、不同用户隔离和无权限反例。
- 已完成：`GET /api/v1/credits/wallet` 与 `GET /api/v1/credits/ledger` 只接受 desktop + `credits.self.read`，流水按 `created_at DESC, id DESC` 游标分页。
- 已完成：新注册用户由受保护触发器自动创建零余额全局钱包；应用角色不能直接执行触发器函数或写钱包/账本。
- 已完成：账务数据库故障只降级 Bootstrap 的积分区，非法在线余额显式失败，不回退或伪装成不可用。

### 节点 5.3：管理端账务只读 UI

- 钱包、订单、流水、预占异常四个只读视图。
- 仅 `credits.manage` 可进入；桌面端不出现后台入口。
- 三视口、键盘、加载/空/错误/无权限状态验收。
- 已完成：新增 `/api/v1/management/credits/wallets`、`/orders`、`/ledger`、`/reservations/anomalies` 四个独立只读接口，统一使用最大 100 条的视图隔离游标分页。
- 已完成：Controller → Service → Repository/Data 单向分层；Controller 和请求参数不接受 tenantId/userId 作为权限依据。
- 已完成：异常预占首期识别 `reserved + expiresAt 已过期`，以及 `reserved + 无 expiresAt + 连续 2 小时未更新`。
- 已完成：管理中心 `/credits` 只对 `management_web + credits.manage` 显示，钱包、充值订单、积分流水、异常预占支持搜索、筛选、翻页、刷新和四类页面状态。
- 已完成：响应不返回渠道私有单号、幂等键、操作人内部标识、价格版本 ID 或 rowVersion；1280×800、768×900、390×844 和键盘页签验收通过，控制台无 error/warn。

### 节点 5.4：充值套餐、订单与支付适配契约

- 管理端套餐新增、编辑、启停使用乐观锁。
- 桌面创建/查询本人订单使用幂等键。
- 先实现无真实资金的 sandbox adapter；真实渠道必须单独提供商户配置、验签规范和回滚预案后接入。
- 已完成：V8/U8 新增套餐创建/更新、订单创建/关闭和 Sandbox 支付五个受控函数；`lingframe_app` 仍无账务表直接写权限。
- 已完成：后端按 Controller → Service → Repository/Data 分层实现桌面本人订单与管理套餐/Sandbox 接口，覆盖终端隔离、CSRF、乐观锁、用户级幂等、跨用户隔离和金额校验。
- 已完成：管理中心 `/credits` 增加第五个“充值套餐”页签、响应式新增/编辑抽屉和单一 Sandbox 支付弹窗；1280×800、768×900、390×844 无横向溢出，键盘页签与控制台验收通过。
- 已完成：隔离迁移 28/28、契约 91/91、Spring Boot 147/147、管理前端 54/54、桌面认证 30/30、模型网关 24/24、Bootstrap 加载 5/5、Smoke 17/17 全部通过；正式 5433 与运行中的 9001 未修改。

#### 5.4.1 本节点行为契约

- 管理端新增 `GET/POST /api/v1/management/credits/packages` 与
  `PUT /api/v1/management/credits/packages/{packageId}`；写操作统一要求
  `management_web + credits.manage + CSRF`，套餐代码创建后不可修改。
- 桌面端新增 `GET /api/v1/recharge-packages`、`POST /api/v1/recharge-orders` 与
  `GET /api/v1/recharge-orders/{orderId}`；只允许 `desktop + credits.self.recharge`，
  userId 永远取服务端 SessionContext。
- 创建订单必须携带 `Idempotency-Key`；同一用户复用相同键且 package/channel 相同返回原订单，
  package/channel 不同返回 `CREDIT_IDEMPOTENCY_CONFLICT`。
- 当前节点只接受 `sandbox` 渠道。管理端可对待支付 Sandbox 订单模拟 `paid / failed / cancelled`；
  金额、积分和赠送积分始终以订单快照为准，客户端不能声明到账积分。
- 支付成功、钱包增加和 `recharge` 流水追加必须在同一数据库事务完成；相同成功事件重复到达只返回原结果，
  不允许第二次增加钱包或追加流水。
- 已过期订单在本人查询或 Sandbox 事件到达时原子关闭；失败、取消、过期均不改变钱包。
- Sandbox 事件入口只存在于管理端测试边界，不开放匿名公网回调，不伪装成微信/支付宝验签已完成。

#### 5.4.2 API 返回边界

- 本人订单响应不返回 `channel_trade_no`、`idempotency_key`、操作者标识或数据库 rowVersion。
- 管理套餐响应返回 rowVersion，作为乐观锁写入所需的公开并发令牌；它不属于支付私有字段。
- Sandbox 支付响应只返回规范化结果、订单状态和是否幂等重放，不返回内部函数名、SQL 或数据库错误。

#### 5.4.3 架构决策：受控命令函数而非普通表写权限

| 选项 | 优势 | 劣势 | 结论 |
| --- | --- | --- | --- |
| 给 `lingframe_app` 直接 INSERT/UPDATE 权限 | Java 实现简单 | 任何 SQL 路径都可绕过流水和状态机，无法从数据库层保护原子性 | 不采用 |
| 新增第二套高权限账务数据源 | 权限可独立 | 增加凭据、连接池、部署和泄露面 | 本阶段不采用 |
| `SECURITY DEFINER` 受控命令函数 + 表继续只读 | 钱包、订单、流水同事务；应用账号仍无普通写权限 | 需要 V8/U8 迁移和函数级安全测试 | 采用 |

**选择理由**：延续 V7 的最小权限边界，同时满足重复回调只入账一次和钱包/流水原子一致。
**接受代价**：账务写契约同时存在 Java Service 与 PostgreSQL 命令函数两层校验，迁移测试必须覆盖函数权限和安全 search_path。
**撤销条件**：未来拆分独立 billing service，并使用独立服务账号和数据库后，重新评估是否把命令边界迁移到独立服务事务。

### 节点 5.5：模型价格版本发布

- 管理端维护 draft，发布 active 版本，历史版本不可覆盖。
- 目录响应增加 pricePreview/pricingVersion，但平台执行仍受代理准备状态控制。

### 节点 5.6：预占、结算、释放与人工调整

- 数据库受控账务函数/应用命令实现行锁、幂等和账本原子写入。
- 覆盖并发余额不足、重复提交、结果未知、回传修复、取消、重试和退款。
- 管理员调整只能追加流水，禁止直接编辑余额。

### 节点 5.7：桌面积分中心与任务计费联通

- 桌面展示余额、流水、订单、预计积分和充值入口。
- 平台模型任务接入预占/结算/释放；豆包和本地 BYOK 行为保持不变。
- 只有真实代理与回传闭环通过后才把对应平台模型 `executionReady` 置为 true。

### 节点 5.8：正式发布与对账验收

- 备份正式库和旧 JAR，维护窗口执行 V7 及后续账务迁移。
- 验证 live/ready、接口、跨租户、重复回调、并发预占、账本/钱包一致性和桌面真实联网。
- 发布后每日对账钱包快照与账本累计差异，任何差异触发告警并冻结账务写入。

## 12. 可测试 Scenarios

### Scenario A：旧租户账户安全合并

- GIVEN 同一用户在两个租户的旧积分都为 125
- WHEN 隔离执行 V7
- THEN 只创建一个全局钱包且可用积分为 125
- AND 只追加一条 125 的 migration 流水

### Scenario B：旧余额冲突阻止迁移

- GIVEN 同一用户在两个租户的旧积分分别为 125 和 80
- WHEN 执行 V7
- THEN 迁移失败且整个 `billing` schema 不存在
- AND 旧 `desktop_data.credit_accounts` 不被修改

### Scenario C：并发预占不透支

- GIVEN 用户可用积分为 100，两次并发任务各需 80
- WHEN 两次预占同时提交
- THEN 只有一次成功
- AND 钱包可用积分不小于 0，预占积分不大于 100

### Scenario D：重复支付回调不重复入账

- GIVEN 订单已由渠道流水 X 支付并入账
- WHEN 相同回调再次到达
- THEN 返回原 paid 结果
- AND 钱包和账本不增加第二次

### Scenario E：结果未知保持预占

- GIVEN 已预占积分且上游提交响应不确定
- WHEN 系统无法确认是否已创建上游任务
- THEN reservation 保持 reserved
- AND 不自动重发、不结算、不释放

### Scenario F：Bootstrap 向后兼容

- GIVEN 同一用户先后选择租户 A 和 B
- WHEN 分别加载 schemaVersion 1 bootstrap
- THEN `credits.balance` 相同且为非负安全整数
- AND 豆包、本地模型网关和 Workspace 行为不变化

## 13. 验收门禁

- **命令 + 输出**：Maven、Node、PowerShell、Docker/PostgreSQL 命令退出码为 0。
- **测试报告**：正常、异常、边界、并发、幂等和回滚路径有明确计数。
- **API 响应**：本人/管理端/支付回调三类终端边界和错误码可复现。
- **数据库证据**：约束、索引、Owner、最小权限、账本不可变、U7 和再次应用通过。
- **桌面回归**：schemaVersion 1、缓存身份绑定、非法在线响应不降级、豆包和本地网关无新增失败。
- **生产边界**：节点 5.0—5.7 默认只在隔离库和开发运行时验证；正式 5433 只能在节点 5.8 维护窗口执行。

## 14. 关键架构决策

### 决策 A：个人钱包全局归属用户

- **选择**：`billing.user_wallets.user_id` 唯一，不包含 tenantId。
- **候选**：继续使用租户钱包；同时维护个人/租户混合钱包。
- **反选理由**：租户钱包与已确认业务规则冲突；混合钱包会让扣费优先级、退款归属和对账复杂度过早膨胀。
- **接受代价**：旧租户账户需要兼容迁移和双读核对。
- **撤销条件**：产品明确上线企业统一付费后，新增独立 tenant wallet 聚合，不修改个人钱包语义。

### 决策 B：账本是真相源，钱包是快照

- **选择**：每次余额变化同事务写钱包和追加式账本。
- **候选**：只保存余额；完全由账本实时聚合余额。
- **反选理由**：只存余额不可审计；实时聚合会放大高频提交延迟和锁范围。
- **接受代价**：必须持续执行钱包与账本一致性对账。
- **撤销条件**：未来采用事件存储并有成熟快照/重放设施时重新评估。

### 决策 C：应用角色不直接写钱包和账本

- **选择**：账务写入通过后续受控数据库函数或严格命令服务完成，V7 初始只授予 SELECT。
- **候选**：给 `lingframe_app` 普通 UPDATE/INSERT；单独新增第二数据源账号。
- **反选理由**：普通 DML 无法从数据库层保证流水与余额原子一致；第二数据源增加密钥、连接池和部署复杂度。
- **接受代价**：受控函数需要额外迁移和安全测试。
- **撤销条件**：系统拆分为独立 billing service，并由独立服务账号和数据库承担账务写入。

## 15. 当前完成定义

节点 5.0 完成必须满足：

- 当前租户级账户与全局钱包的语义冲突已明确并有无损迁移规则。
- 充值和预占状态机、18 条账务不变量、API 边界和桌面兼容策略可自动验证。
- 支付渠道未确定部分明确留在 adapter 边界，不伪装成已接入真实支付。
- 正式数据库、运行中的 9001 和现有桌面生成链均未修改。

节点 5.1 已验证：

- V7 创建 7 张 `billing` 表，U7 只移除 `billing` 并保留 V2—V6 数据。
- 同用户两个租户均为 125 时只迁移一个 125 钱包和一条 migration 流水；125/80 冲突时 V7 原子失败。
- 应用角色直接钱包 UPDATE、账本 INSERT/DELETE 均被拒绝。
- 契约检查 36/36、V7 隔离迁移 19/19、模型目录迁移回归 31/31、Spring Boot 110/110、桌面身份 30/30。
- 正式 `127.0.0.1:5433/lingframe_identity` 和运行中的 9001 未连接、未替换、未重启。

节点 5.2 已验证：

- 本人钱包和流水 API 使用 Controller → Service → Repository/Data 分层，Controller 不依赖 Repository。
- 钱包仅按 `userId` 查询；同一用户切换租户余额一致，不同用户流水隔离，管理端 Token、匿名请求和缺权限会话均被拒绝。
- 流水分页上限 100，非法游标和 101 条请求被拒绝；相同时间戳使用 UUID 次序稳定翻页，不重不漏。
- Bootstrap 保持 `schemaVersion=1`；数据库故障时仅返回 `credits.available=false`，负数或超出 JavaScript 安全整数的在线余额返回 `CREDIT_VALUE_INVALID`。
- 契约检查 53/53、V7 隔离迁移 20/20、模型目录迁移回归 31/31、Spring Boot 123/123、桌面身份 30/30、模型网关 24/24、桌面 Smoke 17/17、Wave 4 桌面联网 6/6。
- 正式 `127.0.0.1:5433/lingframe_identity` 未迁移 V7，运行中的 9001 未替换、未重启，桌面生成链未修改。

节点 5.4 已验证：

- 充值套餐、本人订单与 Sandbox 支付已形成可测试闭环，真实资金渠道仍保持未接入状态。
- 支付成功时订单、钱包和充值流水同事务完成；重复成功事件不重复入账，失败、取消、过期不改变钱包。
- 套餐编辑和启停使用 rowVersion 乐观锁；本人订单使用 userId + Idempotency-Key，不能查询或重放他人订单。
- 管理端五页签、套餐抽屉和 Sandbox 单一弹窗完成 1280×800、768×900、390×844 与键盘验收；新页面控制台 0 error / 0 warning。
- 契约 91/91、V8 隔离迁移 28/28、Spring Boot 147/147、管理前端 54/54、桌面认证 30/30、模型网关 24/24、Bootstrap 加载 5/5、Smoke 17/17。
- 正式 `127.0.0.1:5433/lingframe_identity` 未应用 V7/V8，运行中的 9001 未替换、未重启，豆包、模型网关、创作首页和任务链未修改。
