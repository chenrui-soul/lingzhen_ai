# lingzhen_center 后端技术方案

## 1. 项目定位

`lingzhen_center` 后端是桌面端、Web 管理中心和 PostgreSQL 之间唯一的联网服务层。它负责用户注册与登录、租户隔离、Membership、角色权限、设备与会话、用户积分与充值、平台模型目录与调用、灵帧业务 Skill 目录与执行、审计、公告和数据同步。新平台不再包含密钥激活、密钥验证、授权 Grant 或离线租约业务；所有核心权限规则由 Spring Boot 领域层和应用层执行。

桌面端禁止直连 PostgreSQL。后端 HTTP API 端口永久固定为 `9001`，数据库宿主机端口永久固定为 `5433`。两个端口都不得自动探测、自动递增、自动回退或被运行参数静默覆盖。

## 2. 推荐技术栈

| 层级 | 首选技术 | 用途 |
| --- | --- | --- |
| 运行环境 | Java 21 LTS | 后端运行环境 |
| Web 框架 | Spring Boot 4.0.8 | HTTP API、配置和生命周期管理 |
| 架构模式 | 分层架构 + 轻量领域模型 | 隔离接口编排、业务规则和基础设施 |
| 安全框架 | Spring Security 7 | 登录、RBAC、Token 和接口权限 |
| 参数校验 | Jakarta Validation | 请求 DTO 与业务参数校验 |
| 数据库 | PostgreSQL 16，固定 `127.0.0.1:5433` | 统一身份和业务结构化数据 |
| 数据访问 | Spring Data JPA + Hibernate | Repository、事务和实体映射 |
| 迁移 | Flyway + 版本化 SQL | 可审计、可回滚的数据库变更 |
| 身份认证 | 短期 Access Token + 轮换 Refresh Token | Web 与桌面端登录会话 |
| 密码哈希 | Argon2id | 用户密码安全存储 |
| 接口文档 | SpringDoc OpenAPI | 联调和前端类型生成 |
| DTO 转换 | MapStruct | Entity、领域对象和 API DTO 转换 |
| 日志监控 | SLF4J + Logback + Actuator + Micrometer | 请求追踪、指标和健康检查 |
| 测试 | JUnit 5 + Mockito + Spring Boot Test + Testcontainers | 单元、接口和 PostgreSQL 集成测试 |
| 构建 | Maven Wrapper | 可重复构建与依赖锁定 |
| 部署 | Docker Compose | 与现有 PostgreSQL 分离部署 |

## 3. 选型对比

| 方案 | 优势 | 代价 | 结论 |
| --- | --- | --- | --- |
| Spring Boot + Java | 强类型、事务、安全和企业生态完整，适合复杂长期业务 | 内存和构建成本高于脚本语言 | 首选 |
| FastAPI + Python | 开发速度快，适合 AI 与数据服务 | 大型业务分层和长期类型约束弱于 Java | 备选 |
| Fastify + TypeScript | 与 Electron 技术链接近，接口开发轻量 | 核心授权业务的结构约束依赖团队规范 | 不选 |
| Spring Boot 4.0.8 + SpringDoc 3.0.2 | 已验证兼容 Java 21 与当前 OpenAPI 方案 | 新主版本需要更严格的回归测试 | 首选 |

接受的代价：Spring Boot 的启动时间、镜像体积和内存占用高于 Python/Node.js，但本项目优先保证身份、权限、会话和多租户业务的长期正确性。Java 运行时升级到 25 LTS 或 Spring Boot 下一主版本前必须完成兼容性与回归测试。

## 4. 模块与目录规划

```text
src/
├─ main/
│  ├─ java/com/lingzhen/center/
│  │  ├─ LingzhenCenterApplication.java
│  │  ├─ config/                 # 安全、数据库、Jackson、OpenAPI
│  │  ├─ common/                 # 错误码、分页、ID、幂等与审计上下文
│  │  ├─ interfaces/rest/        # Controller、请求和响应 DTO
│  │  ├─ application/            # 用例编排、事务边界
│  │  ├─ domain/
│  │  │  ├─ auth/
│  │  │  ├─ user/
│  │  │  ├─ tenant/
│  │  │  ├─ membership/
│  │  │  ├─ accesscontrol/
│  │  │  ├─ billing/
│  │  │  ├─ modelcatalog/
│  │  │  ├─ skillcatalog/
│  │  │  ├─ skillexecution/
│  │  │  ├─ device/
│  │  │  ├─ session/
│  │  │  ├─ announcement/
│  │  │  └─ audit/
│  │  └─ infrastructure/         # JPA、签名、文件迁移和外部适配
│  └─ resources/
│     ├─ application.yml
│     └─ db/migration/
└─ test/
   └─ java/com/lingzhen/center/
```

依赖方向保持为：`interfaces → application → domain ← infrastructure`。Controller 不写业务逻辑，JPA Entity 不直接作为 API 响应；注册邀请、Membership、角色权限、功能策略和会话规则必须位于 domain/application 层。

## 5. 数据模型规划

后续通过版本化迁移创建表，不直接修改已完成的数据库初始化脚本。

### identity schema

- `users`：用户身份、状态和密码哈希
- `tenants`：租户及状态
- `tenant_memberships`：用户、租户和角色
- `platform_role_assignments`：平台全局角色分配，与租户 Membership 硬隔离
- `tenant_invitations`：租户邀请、目标角色、有效期和一次性消费状态
- `tenant_selection_tickets`、`tenant_selection_ticket_memberships`：多租户登录的一次性票据和候选 Membership 白名单
- `roles`、`permissions`、`role_permissions`
- `permission_overrides`：受审计的用户/租户显式 allow 或 deny 覆盖
- `feature_policies`：用户或租户功能启停、范围和生效时间
- `devices`：按租户和 `client_type` 隔离的终端摘要和可信状态，不绑定单个用户
- `user_sessions`：同时绑定用户、租户、Membership、设备、`client_type`、过期时间和撤销状态
- `refresh_tokens`：只保存 Token 哈希、轮换链和复用检测信息

### billing schema

- `user_wallets`：用户可用积分、冻结积分和并发版本
- `recharge_packages`：服务端维护的充值套餐和赠送规则
- `recharge_orders`：支付订单、渠道流水和支付状态
- `credit_ledger`：不可覆盖的积分入账、预占、结算、释放、退款和调整流水
- `credit_reservations`：模型任务与 attempt 的积分预占和最终结算

### model_catalog schema

- `providers`：模型厂商、协议、路由、并发、超时和健康状态
- `provider_credentials`：平台模型凭据引用或密文，仅后端可读
- `models`：模型代码、显示名、能力、参数 Schema 和启停状态
- `model_prices`：版本化积分价格，任务保留提交时价格快照
- `tenant_models`：租户启用、隐藏和自定义覆盖
- `catalog_versions`：桌面端可获取的已发布模型目录版本

### skill_catalog schema

- `skills`：Skill 稳定身份、业务 Skill/Codex Agent Skill 类型和状态
- `skill_versions`：不可覆盖的输入/输出 Schema、步骤、能力声明、校验和与签名
- `skill_packages`：后台管理员上传包的对象存储引用、大小、摘要、签名和扫描状态
- `skill_model_bindings`：Skill 步骤与模型版本、参数映射和兼容条件
- `tenant_skills`：租户启停、参数覆盖和可见范围
- `skill_executions`：用户、租户、项目、版本快照、计费上下文和终态
- `skill_execution_steps`：持久化 step、attempt、进度、外部任务 ID 和错误摘要
- `skill_approvals`：高风险能力的一次性审批请求和决策

### workspace / sync / audit schema

- `workspace.projects`：后续联网项目基础信息
- `sync.change_log`、`sync.client_cursors`、`sync.conflicts`
- `audit.audit_logs`：不可静默修改的操作审计
- `audit.security_events`：登录失败、Token 复用和越权行为

所有业务表包含 `id`、`created_at`、`updated_at`；租户数据必须包含 `tenant_id`。数据库只保存结构化数据和对象存储引用，不保存图片、视频 Blob、豆包 Cookie 或 Chrome Profile。

## 6. 登录与会话方案

### Web 管理中心

1. 用户名/邮箱和密码登录。
2. Argon2id 校验密码。
3. 创建 `client_type=management_web` 的 Session，返回短期 Access Token，并通过 HttpOnly Cookie 保存轮换 Refresh Token。
4. Refresh Token 在数据库中只保存哈希；每次续期都轮换。
5. 检测到旧 Token 再次使用时，撤销整条会话链并记录安全事件。

### 桌面端

1. 新用户可通过注册 API 创建账号；无邀请码时原子创建个人租户和 `owner` Membership，有邀请码时加入目标租户并获得邀请指定角色。
2. 桌面端调用统一登录 API，并提交稳定但不可逆推导个人信息的设备 ID。
3. Access Token 短期有效；Refresh Token 使用 Electron `safeStorage` 保存。
4. 正式 Session 必须绑定 `user_id + tenant_id + membership_id + device_id + client_type=desktop`；多租户用户先使用短期一次性票据选择租户。
5. 桌面端只负责使用。每次请求共同校验用户、租户、Membership、设备、`client_type`、RBAC permission 和功能策略；积分只在平台付费模型调用时额外判断。
6. 网络中断时只允许本地权限快照明确开放的本机能力；平台模型、充值和联网写操作暂停，恢复联网后自动刷新 Session 和权限。

桌面端 Session 只允许注册登录、租户选择、本人账户、充值、创作、任务、素材、同步、已授权模型/Skill 调用和必要的本机配置。即使账号拥有 `owner/admin/platform_admin`，桌面端 Token 也不能访问成员、角色、权限策略、公共模型目录、平台 Skill 发布、审计或系统管理 API。

## 7. API 规划

### 新接口

接口按终端分域：

- 共享认证与本人账户：`/api/v1/auth/*`、本人积分和充值查询。
- 桌面使用端：`/api/v1/desktop/*`、创作任务、本人项目/素材、本人同步和 Skill 执行。
- 管理中心：用户、租户、Membership、邀请、角色、权限、功能策略、模型目录、平台 Skill、审计和系统状态管理接口。

管理中心接口必须同时满足 `client_type=management_web` 和对应管理 permission；`client_type=desktop` 无条件拒绝管理接口，不能只依赖客户端隐藏按钮。

- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `POST /api/v1/auth/select-tenant`
- `POST /api/v1/auth/refresh`
- `POST /api/v1/auth/logout`
- `GET /api/v1/auth/me`
- `GET /api/v1/desktop/bootstrap`
- `/api/v1/users`
- `/api/v1/tenants`
- `/api/v1/tenant-memberships`
- `/api/v1/tenant-invitations`
- `/api/v1/roles`
- `/api/v1/permissions`
- `/api/v1/feature-policies`
- `/api/v1/devices`
- `/api/v1/sessions`
- `/api/v1/announcements`
- `/api/v1/audit-logs`
- `/api/v1/credits/*`
- `/api/v1/recharge-packages`
- `/api/v1/recharge-orders`
- `/api/v1/model-providers`
- `/api/v1/models`
- `/api/v1/model-catalog-versions`
- `GET /api/v1/desktop/models`
- `GET /api/v1/desktop/skills`
- `/api/v1/skills`
- `/api/v1/skill-versions`
- `/api/v1/tenant-skills`
- `/api/v1/skill-executions`
- `/api/v1/skills/{skillId}/version-uploads`
- `/api/v1/skill-version-uploads/{uploadId}/complete`
- `/api/v1/skill-versions/{versionId}/publish`
- `/api/v1/desktop/skills/{skillId}/download-tickets`
- `/api/v1/sync/*`

### 旧认证退场边界

- 新平台不提供 `POST /api/v1/activate`、`POST /api/v1/verify` 或任何等价密钥接口。
- 旧客户端只可在限定升级窗口访问独立旧服务；旧服务不得复用新平台 Session、Membership 或权限表。
- 新客户端只读取旧认证文件用于识别升级来源和保护本地数据，不使用其中的密钥、Token、Grant 或租约计算权限。
- 升级完成后停用独立旧服务；新平台代码和数据库不保留 `licensing` 业务模块。

接口统一使用请求 ID、结构化错误码、游标分页和后端权限校验。注册、接受邀请、角色调整、成员移除、功能策略变更和强制下线等写操作使用幂等键或唯一约束。

### Skill 执行边界

- 对于平台 Skill，只有平台后台管理员可以上传、审核和发布；租户管理员只能启停和配置，普通用户只能调用。桌面端本地 Skill 不进入这套后台发布权限。
- Spring Boot 只直接执行审核通过的灵帧业务 Skill，不在服务端运行用户或租户管理员上传的任意脚本。
- 桌面端用户允许导入本地 Skill，但本地包、脚本和资产不上传 Spring Boot，不进入 `skill_catalog`，后端只在需要时接收脱敏执行审计摘要。
- Skill 编排首期使用 application service + 持久化 step + 定时恢复扫描，不急于引入 Camunda 等重型工作流引擎。
- 每次执行锁定 `skillVersion + modelVersion + pricingVersion`，并使用 `userId + clientRequestId` 保证幂等。
- 长步骤采用创建执行、异步 step、状态查询/SSE、取消和恢复模式，不使用单个 HTTP 请求等待整个 Skill 完成。
- Codex Agent Skill 由桌面端本机运行时执行；后端只负责目录授权、租户策略、必要的积分调用端点和审计摘要，不接收本地文件正文或任意命令。

## 8. 安全方案

- Spring Boot 启动时校验配置，缺少数据库或签名配置立即失败。
- `server.port` 在 `application.yml` 固定为 `9001`，并增加启动校验；即使通过命令行或环境变量覆盖为其他值，也必须启动失败。
- 数据库应用只使用 `lingframe_app`，不使用所有者账号运行 HTTP 服务。
- 注册、登录、刷新、找回密码和邀请接受接口分别限流。
- 密码使用 Argon2id；Refresh Token、注册/邀请一次性票据只保存哈希。
- 所有 SQL 通过 Spring Data JPA 参数绑定或受审查的参数化查询执行，禁止拼接外部输入。
- 每个查询显式带 `tenant_id`，管理权限由服务端 RBAC 判断。
- Session 和 Access Token 必须携带受签名保护的 `client_type`；管理接口先校验 `management_web`，再校验角色 permission。
- `desktop/bootstrap` 只返回使用端权限白名单，不返回成员、角色、目录发布、审计或系统管理 permission。
- 签名私钥只在后端加载，永不返回给前端和桌面端。
- 支付成功只能由验签通过的支付渠道回调确认，客户端不能直接修改订单为已支付。
- 平台模型 API Key、完整上游 URL 和私有 Header 不返回桌面端；桌面端只获取有效模型目录和非敏感参数定义。
- Skill 包、版本和能力声明必须校验摘要与签名；普通用户不能发布可执行脚本。
- 上传包必须在隔离暂存区完成 Zip Slip、Zip Bomb、符号链接、文件类型、恶意脚本、依赖许可和敏感信息扫描；扫描通过后才能签名和发布。
- 桌面端下载使用短期票据并绑定用户、租户、设备、Skill 和版本；对象存储地址不能长期公开。
- 本地 Skill 必须在 Electron 主进程隔离校验后复制到受管目录；后端不能把本地 Skill 标记为平台签名或为其签发平台下载票据。
- 高风险能力采用声明能力、平台安全策略、租户功能策略、Membership 角色和本次审批的交集授权。
- 错误响应不返回堆栈、SQL、内部路径和敏感配置。
- 日志自动脱敏 password、token、cookie、authorization 和数据库连接串。
- 用户、租户、Membership、角色、功能策略、设备和会话变更写入审计日志。

## 9. 并发、幂等与异常处理

- 同一 Refresh Token 只允许一次成功轮换，使用事务和唯一约束处理并发。
- 注册时用户、个人租户和 owner Membership 必须在同一事务提交，任一失败不得留下孤立记录。
- 邀请接受按 `invitation_id + user_id` 幂等消费，一次性票据不能重放或跨租户使用。
- 充值订单按订单号和支付渠道流水双重幂等，重复回调只允许入账一次。
- 平台模型任务在调用上游前锁定用户钱包并预占积分；成功后结算，失败后释放，状态未知时保持预占且禁止自动重发。
- 同一 `clientRequestId` 重复提交必须返回原任务、原价格版本和原积分预占。
- 同一 Skill step 使用稳定幂等键；服务重启只恢复未完成 step，不重复执行已确认成功的外部调用。
- 审批 ID 一次性消费并绑定执行、用户、能力、目标范围和过期时间，拒绝重放或跨执行使用。
- 用户、租户、Membership、设备和邀请使用显式状态机，禁止非法状态跳转。
- 数据迁移任务使用任务表和 PostgreSQL advisory lock，避免并行重复迁移。
- 首期不引入 Redis；只有出现多实例限流、队列或热点缓存需求时再增加。
- 外部调用必须设置超时；写请求不进行无幂等保证的自动重试。

## 10. 旧认证数据退场

1. `data/license-center.json` 和桌面端旧认证文件只作为升级期只读备份，不导入新平台权限表。
2. 旧密钥、激活记录、Activation Token、Grant、租约和设备额度全部停止迁移，不转换成 Membership 或 permission。
3. 如需迁移公告等非认证业务数据，必须使用独立白名单迁移工具，只读取明确字段并生成预检报告。
4. 升级登录后只重建用户、租户和本地数据关联；项目、素材、任务、文本记忆和豆包 Profile 不因认证退场被删除。
5. 验证升级成功前不删除旧文件；超过约定升级周期后，由明确的清理流程移除备份。

## 11. 测试方案

- 单元测试：注册、邀请、状态机、权限、`client_type` 终端隔离、密码、Token 轮换和错误码。
- 接口测试：注册、登录、租户选择、刷新、退出、成员与角色管理、充值、积分、模型目录、Skill 目录/执行和管理接口。
- 数据库集成测试：注册事务原子性、邀请幂等、唯一约束、租户隔离、并发刷新、支付回调幂等、钱包并发预占、Skill 幂等执行和 step 崩溃恢复。
- 升级测试：新客户端不调用 `activate/verify`，旧认证文件不参与权限判断且本地创作数据保持完整。
- 安全负例：错误密码、失效 Token、越权租户、重放 Token、SQL 注入输入和限流。
- 终端隔离负例：使用 owner/admin/platform_admin 的桌面端 Token 调用任一管理接口必须返回 403，且 `desktop/bootstrap` 不包含管理 permission。
- Skill 安全负例：非平台管理员调用平台上传、路径穿越包、超大解压包、符号链接、摘要不一致、签名无效、下载票据跨租户重放，以及本地 Skill 冒充平台版本。
- 恢复测试：服务重启、数据库短暂不可用、迁移中断、Session 恢复和权限快照过期。

CI 最少执行：`mvn spotless:check → mvn test → mvn verify → package`。

## 12. 部署与可观测性

- 后端独立 Docker 容器，通过内部网络连接 PostgreSQL。
- 数据库宿主机端口保持 `5433`，禁止自动变化。
- API 监听端口固定为 `9001`，Docker 映射固定为 `127.0.0.1:9001:9001`，禁止自动换端口。
- 旧客户端迁移窗口内继续访问独立旧服务；新客户端直接切换到固定 `9001`，两套服务不共享认证状态。
- 健康检查拆分为 `/health/live` 和 `/health/ready`。
- 日志字段至少包含 requestId、userId、tenantId、deviceId、route、statusCode 和 durationMs，敏感字段必须脱敏。
- 监控登录失败率、401/403/429/500、数据库连接池、慢查询、Token 复用和迁移失败。
- 监控支付回调失败、重复回调、账实不符、积分预占超时、模型目录发布失败、厂商不可用和模型任务成本异常。
- 监控 Skill 执行排队时长、step 失败率、审批等待时长、僵尸执行、版本签名失败和事件流断线恢复率。

## 13. 实施顺序

1. 初始化 Java 21、Spring Boot 4.0.8、Maven Wrapper、固定 9001 端口校验和健康检查。
2. 建立 Spring Data JPA、Flyway 迁移和 Testcontainers 数据库测试环境。
3. 重写未部署的身份迁移，移除 `licensing` 和 `license.*` 权限，补充 `member`、邀请和功能策略。
4. 实现注册、登录、租户选择、Membership、RBAC、设备和会话。
5. 实现管理 API、公告和审计日志。
6. 实现用户积分钱包、充值订单、支付回调、积分流水和任务预占结算。
7. 实现模型厂商、模型目录、能力参数、版本化价格和桌面端有效模型接口。
8. 实现 Skill 目录、版本、模型绑定、租户启停、执行 step、审批和桌面端有效 Skill 接口。
9. 实现旧认证文件只读识别、本地数据保护和升级引导；不迁移密钥授权数据。
10. 联调 Web 管理中心、桌面端登录、积分余额、模型目录和 Skill 中心。
11. 完成安全、并发、崩溃恢复和发布验证。

## 14. 验收标准

- 服务使用 `lingframe_app` 成功连接固定 `5433` 数据库。
- HTTP 服务只允许在固定 `9001` 启动；覆盖为其他端口时必须明确失败。
- 用户注册、个人租户创建、邀请加入、登录、租户选择、刷新、退出、强制下线和 Token 重放检测通过。
- 不同租户不能读取或修改彼此数据。
- 桌面端用户只负责使用：桌面 Token 无法调用租户、成员、角色、公共模型目录、平台 Skill、审计或系统管理接口。
- 新平台不存在密钥认证、`licensing` schema、`license.*` permission、Activation Token、Grant 或离线租约依赖。
- 重复支付回调不能重复增加积分，并发模型任务不能导致余额透支。
- 平台模型任务只在成功结果校验通过后结算一次积分；明确失败释放预占。
- 桌面端只能获得当前用户、Membership、租户策略和角色权限允许的模型目录，响应中不包含平台模型调用凭据。
- 桌面端只能执行当前用户、Membership、租户策略和版本允许的 Skill；重复提交不重复执行或扣费，服务重启可从 step 检查点恢复。
- Codex Agent Skill 不由 Spring Boot 远程执行任意本机命令，服务端不保存用户导入的本地 Skill、文件正文或脚本资产。
- 旧认证文件不进入新权限体系；升级后本地项目、素材、任务、文本记忆和豆包 Profile 保持完整。
- `mvn test`、`mvn verify` 和 Spring Boot 生产构建全部通过。
