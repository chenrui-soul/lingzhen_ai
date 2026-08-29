# Wave 3：模型目录最小完整闭环

## 0. 规划状态

- **状态**：执行中；节点 3.0—3.3 已完成，节点 3.4 后端写入契约已完成，下一步实现管理端抽屉表单与节点联调。
- **推荐执行模块**：模型目录。
- **依赖基线**：Wave 2 管理中心、统一身份、RBAC、`SessionContext` 租户隔离和桌面端 bootstrap 均保持通过。
- **固定端口**：Spring Boot `9001`；管理中心前端 `5173`；PostgreSQL `127.0.0.1:5433/lingframe_identity`。
- **正式库边界**：普通启动继续保持 `spring.flyway.enabled=false`；V5 只能先在隔离 PostgreSQL 验证，正式 `5433` 不在本 Wave 自动迁移。

## 1. 为什么 Wave 3 先做模型目录

| 候选模块 | 前置依赖 | 当前收益 | 主要风险 | 结论 |
| --- | --- | --- | --- | --- |
| 模型目录 | 统一身份、权限、租户、bootstrap | 直接打通“管理端维护 → 租户策略 → 桌面端获知模型” | 发布快照与桌面兼容 | **Wave 3 执行** |
| 积分管理 | 模型目录、价格版本、支付渠道、任务计费状态机 | 可充值、预占、结算 | 账务一致性、支付回调、退款与对账 | Wave 4 |
| Skill 管理 | 模型目录、对象存储、签名、扫描、审批 | 平台 Skill 可发布 | 供应链安全和执行权限风险最高 | Wave 5 |

模型目录是积分定价和 Skill 模型绑定的共同前置依赖。三个模块同时实现会把目录发布、账务事务、文件供应链和桌面运行时耦合在一起，无法形成安全、可回滚的节点验收。

## 2. 项目启动信息

- **项目类型**：Spring Boot 模块化单体后台模块 + Vue 3 Web 管理页面 + Electron 桌面 bootstrap 联通。
- **业务目标**：平台管理员维护模型目录并发布不可变版本；租户管理员控制当前租户模型可见性；桌面端只读取当前租户有效目录。
- **终极功能**：管理端发布一个模型目录版本后，只有被当前租户允许的模型会通过桌面端 bootstrap 返回，并且不会泄露任何平台凭据或私有调用信息。
- **成功标准**：
  1. 发布前的草稿改动不影响当前桌面目录；发布后新版本原子生效。
  2. A 租户的策略不能影响或读取 B 租户，`tenantId` 只来自 `SessionContext`。
  3. 旧桌面端仍接受 `schemaVersion = 1`，现有豆包与本地模型网关选择和调用行为不变化。
  4. 管理页面在 `1280×800`、`768×900`、`390×844` 下无横向遮挡，核心路径支持键盘操作。
- **默认循环轮次**：3。
- **安全最大轮次**：6。
- **每轮最大改动点数**：3 个原子任务。

## 3. 范围

### 3.1 In scope

- 平台模型厂商的非敏感资料维护。
- 模型基础资料、能力类型、非敏感参数 Schema、默认参数和草稿状态维护。
- 模型目录发布预览、不可变版本快照和当前版本切换。
- 当前租户对模型的 `inherit / enabled / hidden` 策略。
- 管理端模型目录页面、当前租户策略页面及权限控制。
- `GET /api/v1/desktop/models` 与 `GET /api/v1/desktop/bootstrap` 返回当前租户有效目录。
- 后端单元、PostgreSQL 集成、租户隔离、乱序/并发发布、前端和浏览器验收。

### 3.2 Out of scope

- 平台模型真实代理调用和生成任务提交。
- 模型价格、积分预占、扣费、充值、支付回调、退款和对账。
- 平台 API Key、完整私有 Base URL、私有 Header 和凭据轮换。
- 自动模型发现、真实健康探测和自动故障转移。
- Skill 上传、扫描、签名、发布和模型绑定。
- 将联网平台模型直接混入现有桌面端 `model-gateway` 选择器。

> Wave 3 的桌面端只缓存并识别平台目录，模型项标记 `executionReady=false`。在平台代理和积分结算完成前，不允许把这些模型伪装成本地模型网关模型，否则用户选择后必然调用失败。

## 4. 不可破坏基线

1. 后端继续遵守 `Controller → Service → Repository → PostgreSQL`。
2. Controller 不引用 Repository、Entity 或 `service.impl`；事务只放在 `service.impl`。
3. DTO 与 Entity 分离，ArchUnit 门禁必须继续通过。
4. 管理端接口必须要求 `client_type=management_web`；桌面端 Token 调用管理接口固定返回 403。
5. 桌面端接口必须要求 `client_type=desktop` 和 `model.use` / `desktop.bootstrap`。
6. `tenantId` 不出现在查询参数或请求体中，只从已验证的 `SessionContext` 取得。
7. 桌面 bootstrap 的 `schemaVersion` 在 Wave 3 保持 `1`。新增字段只能采用向后兼容的可选字段。
8. 现有豆包账号、本地 BYOK 模型网关、创作首页、任务中心和无限画布调用链不改路由、不改状态机。

## 5. 总体架构

```text
平台管理员（management_web）
  → 模型草稿 / 厂商资料
  → 发布预览
  → 原子发布 Catalog Version N
  → 不可变 Catalog Version Items

租户管理员（management_web + tenant_model.manage）
  → 当前租户 inherit / enabled / hidden 策略

桌面用户（desktop + model.use）
  → DesktopModelCatalogService
  → 当前发布版本 ∩ 当前租户有效策略
  → bootstrap.models / GET desktop/models
  → 本地只缓存，暂不进入生成选择器
```

依赖方向：

```text
ModelCatalogController ──> ModelCatalogService ──> ModelCatalogRepository
TenantModelController ───> TenantModelService ───> TenantModelRepository
DesktopModelController ──> DesktopModelCatalogService ──> ModelCatalogRepository
DesktopBootstrapService ─> DesktopModelCatalogService
```

模型目录是全局平台数据；`tenant_models` 是租户数据。平台目录不带 `tenant_id`，租户策略必须带 `tenant_id`，两类写入由不同 permission 隔离。

## 6. 数据库设计

### 6.1 迁移文件

- `V5__create_model_catalog_tables.sql`
- `U5__drop_model_catalog_tables.sql`
- 更新迁移 `DESIGN.md`、`README.md`、隔离迁移脚本和 SQL 断言。
- V5 由 `lingframe_owner` 创建并拥有独立 `model_catalog` schema，再按最小权限向 `lingframe_app` 授权；不把新表继续塞入 `identity` schema。

### 6.2 表结构

#### `model_catalog.providers`

| 字段 | 说明 |
| --- | --- |
| `id uuid` | 主键 |
| `provider_code varchar(64)` | 稳定代码，全局唯一 |
| `display_name varchar(120)` | 管理端和桌面展示名 |
| `protocol_family varchar(32)` | `openai_compatible / anthropic_compatible / custom_proxy` |
| `description text` | 非敏感说明 |
| `status varchar(16)` | `draft / active / inactive` |
| `row_version bigint` | 乐观锁 |
| `created_at / updated_at` | 审计时间 |

本 Wave 不保存凭据、Base URL 或私有 Header。

#### `model_catalog.models`

| 字段 | 说明 |
| --- | --- |
| `id uuid` | 稳定模型身份 |
| `provider_id uuid` | 所属厂商 |
| `model_code varchar(128)` | 厂商内唯一调用代码 |
| `display_name varchar(160)` | 展示名 |
| `capability_type varchar(16)` | `text / image / video / audio` |
| `description text` | 能力说明 |
| `parameter_schema jsonb` | 仅非敏感参数 JSON Schema |
| `default_parameters jsonb` | 默认非敏感参数 |
| `default_tenant_enabled boolean` | 没有租户覆盖时的平台默认值，新增模型默认 `false` |
| `sort_order integer` | 排序 |
| `status varchar(16)` | `draft / active / inactive` |
| `row_version bigint` | 乐观锁 |
| `created_at / updated_at` | 审计时间 |

约束：Schema 与默认参数必须是 JSON object；模型启用前厂商必须 active；已发布模型不硬删除，只能停用并重新发布。

#### `model_catalog.catalog_versions`

| 字段 | 说明 |
| --- | --- |
| `id uuid` | 版本主键 |
| `version_no bigint` | 单调递增、唯一 |
| `is_current boolean` | 只能有一个 current 版本 |
| `content_hash varchar(64)` | 规范化快照 SHA-256 |
| `idempotency_key varchar(128)` | 发布请求幂等键，唯一 |
| `published_by_user_id uuid` | 发布人 |
| `published_by_membership_id uuid` | 发布时 Membership |
| `published_at timestamptz` | 发布时间 |
| `created_at` | 创建时间 |

数据库内部发布顺序固定为：同事务插入 `published_at=NULL` 的版本头 → 写完整快照 → 设置 `published_at` 并切换 current。延迟约束在提交前拒绝未封存或空快照版本。

#### `model_catalog.catalog_version_items`

发布时复制厂商、模型、能力、参数 Schema、默认参数、默认租户策略和排序，发布后不允许 UPDATE/DELETE。历史版本不能通过关联当前草稿字段动态重建。

核心唯一键：`(catalog_version_id, model_id)`、`(catalog_version_id, provider_code, model_code)`。

#### `model_catalog.tenant_models`

| 字段 | 说明 |
| --- | --- |
| `id uuid` | 主键 |
| `tenant_id uuid` | 当前租户 |
| `model_id uuid` | 稳定模型身份 |
| `policy varchar(16)` | `inherit / enabled / hidden` |
| `updated_by_membership_id uuid` | 同租户操作者 |
| `row_version bigint` | 乐观锁 |
| `created_at / updated_at` | 审计时间 |

唯一键：`(tenant_id, model_id)`。`updated_by_membership_id + tenant_id` 使用复合外键，数据库拒绝跨租户操作者。

### 6.3 有效目录计算

```text
当前 catalog_version_items
AND provider/model 均存在于发布快照
AND effective_enabled =
    tenant policy = enabled
    OR (tenant policy = inherit/不存在 AND item.default_tenant_enabled = true)
AND tenant policy != hidden
```

草稿状态改变不会影响已发布目录。模型从 active 改为 inactive 后，必须再次发布，桌面端才会看到目录变化。

### 6.4 权限

- `lingframe_owner`：迁移和 DDL。
- `lingframe_app`：目录和租户策略所需 SELECT/INSERT/UPDATE；无 DDL、无发布快照硬删除。
- `model_catalog.read/manage/publish`：平台目录。
- `tenant_model.read/manage`：当前租户策略。
- `model.use`：桌面读取有效目录。

## 7. API 契约

### 7.1 平台模型目录

| 方法 | 路径 | Permission | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/management/model-catalog/providers` | `model_catalog.read` | 厂商列表 |
| POST | `/api/v1/management/model-catalog/providers` | `model_catalog.manage` | 新增厂商草稿 |
| PUT | `/api/v1/management/model-catalog/providers/{providerId}` | `model_catalog.manage` | 编辑资料、状态和 rowVersion |
| GET | `/api/v1/management/model-catalog/models` | `model_catalog.read` | 筛选、分页模型 |
| POST | `/api/v1/management/model-catalog/models` | `model_catalog.manage` | 新增模型草稿 |
| PUT | `/api/v1/management/model-catalog/models/{modelId}` | `model_catalog.manage` | 编辑模型、Schema、状态和 rowVersion |
| GET | `/api/v1/management/model-catalog/publish-preview` | `model_catalog.publish` | 对比当前发布版本，返回新增/修改/移除 |
| POST | `/api/v1/management/model-catalog/versions/publish` | `model_catalog.publish` | 原子发布新版本 |
| GET | `/api/v1/management/model-catalog/versions` | `model_catalog.read` | 版本历史 |
| GET | `/api/v1/management/model-catalog/versions/{versionId}` | `model_catalog.read` | 只读版本快照 |

所有写接口要求 CSRF、`Idempotency-Key`（发布必填）和 `rowVersion`（更新必填）。不接受 `tenantId`。

### 7.2 当前租户模型策略

| 方法 | 路径 | Permission | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/management/tenant-models` | `tenant_model.read` | 当前租户可配置模型和有效状态 |
| PUT | `/api/v1/management/tenant-models/{modelId}` | `tenant_model.manage` | 设置 `inherit/enabled/hidden` |

租户只允许对当前发布版本中存在的稳定 `modelId` 设置策略。请求体不包含 `tenantId`。

### 7.3 桌面端

| 方法 | 路径 | Permission | 用途 |
| --- | --- | --- | --- |
| GET | `/api/v1/desktop/models` | `model.use` | 独立刷新当前租户目录 |
| GET | `/api/v1/desktop/bootstrap` | `desktop.bootstrap` | 同时返回当前租户目录摘要 |

桌面模型项建议契约：

```json
{
  "id": "uuid",
  "source": "platform",
  "provider": { "id": "uuid", "code": "lingzhen", "displayName": "灵帧平台" },
  "code": "video-model-code",
  "displayName": "视频模型",
  "capabilityType": "video",
  "parameterSchema": {},
  "defaultParameters": {},
  "catalogVersion": 1,
  "executionReady": false
}
```

禁止返回：API Key、凭据引用、完整私有 URL、私有 Header、数据库字段、内部异常堆栈。

### 7.4 主要错误码

- `MODEL_PROVIDER_NOT_FOUND`
- `MODEL_NOT_FOUND`
- `MODEL_CODE_CONFLICT`
- `MODEL_SCHEMA_INVALID`
- `MODEL_PROVIDER_NOT_ACTIVE`
- `MODEL_ROW_VERSION_CONFLICT`
- `CATALOG_NO_CHANGES`
- `CATALOG_VERSION_CONFLICT`
- `CATALOG_PUBLISH_IN_PROGRESS`
- `TENANT_MODEL_POLICY_INVALID`
- `TENANT_MODEL_FORBIDDEN`
- `DESKTOP_MODEL_CATALOG_FORBIDDEN`

## 8. 后端分层与文件组织

### Controller 层

- `controller/ModelCatalogController.java`
- `controller/TenantModelController.java`
- `controller/DesktopModelController.java`
- 现有 `DesktopBootstrapController.java` 只维持 HTTP 契约。

### Service 层

- `service/ModelCatalogQueryService.java`
- `service/ModelCatalogCommandService.java`
- `service/CatalogPublicationService.java`
- `service/TenantModelService.java`
- `service/DesktopModelCatalogService.java`
- `service.impl/*Impl.java` 承担权限复核、状态机、事务、发布锁和 DTO 组装。

### Repository 层

- `repository/ModelCatalogRepository.java`
- `repository/ModelCatalogPersistenceAdapter.java`
- `repository/TenantModelRepository.java`
- `repository/TenantModelPersistenceAdapter.java`
- Repository 所有租户查询显式接收 `SessionContext.tenantId()`；Controller 不传租户 ID。

### Model 层

- `model/entity/modelcatalog/*Entity.java`
- `model/dto/modelcatalog/*Request.java`
- `model/dto/modelcatalog/*Response.java`
- `model/enums/ModelCapabilityType.java`
- `model/enums/ModelCatalogStatus.java`
- `model/enums/TenantModelPolicy.java`

## 9. 管理中心 UX/UI 方案

### 9.1 信息架构

侧栏将“模型目录”从禁用项改为权限驱动入口，统一进入 `/models`：

- 有 `model_catalog.read`：显示“平台目录”页签。
- 有 `tenant_model.read`：显示“当前租户”页签。
- 两者都有：默认进入平台目录，并记住本会话上次页签。
- 没有任何权限：侧栏不显示，构造 URL 返回 403。

### 9.2 平台目录页面

页面保持深蓝、青色、Ant Design Vue 体系，但避免堆叠卡片：

1. 顶部标题区：当前发布版本、最近发布时间、“存在未发布变更”状态和发布按钮。
2. 单层工具栏：能力类型、状态、厂商、关键词筛选；“新增模型”是唯一主按钮。
3. 主内容：宽表格展示模型名、厂商、能力、默认租户策略、草稿状态、修改时间和操作。
4. 厂商维护放入独立抽屉，不在页面左侧再放永久厂商栏，给模型列表保留空间。
5. 模型新增/编辑使用宽抽屉；参数 Schema 分“可视化基础字段 + 高级 JSON”两级，错误定位到具体字段。
6. 发布使用三步弹窗：差异摘要 → 风险确认 → 发布结果；同一时间只允许一个弹窗。

### 9.3 当前租户页面

- 顶部只显示当前租户名称和当前目录版本，不允许选择或传入其他 tenantId。
- 每个模型显示“平台默认 / 已启用 / 已隐藏”三态控件和最终有效状态。
- “恢复平台默认”不删除业务对象，只将策略写回 `inherit`。
- 批量启停不在 Wave 3 首期开放，避免误操作和跨页选择复杂度。

### 9.4 响应式和可访问性

- `>= 1024px`：表格布局，内容最大宽度不锁死，使用现有页面留白。
- `640px–1023px`：隐藏次要列，详情进入抽屉。
- `< 640px`：模型改为单层列表卡，不嵌套卡片；主操作固定在卡片尾部。
- 所有按钮可键盘聚焦；抽屉和弹窗支持 Escape；焦点关闭后回到触发按钮。
- Loading 使用骨架；Empty 提供明确创建入口；Error 显示请求 ID 和重试；Forbidden 不闪现页面内容。
- 表单错误不用只靠颜色，必须有文字和 `aria-describedby`。

## 10. Wave 3 节点计划

### 节点 3.0：契约与桌面兼容审计

- **节点状态**：已完成（2026-08-25）。
- **验收结果**：bootstrap `schemaVersion=1` 已锁定；平台模型采用强类型白名单；敏感字段、原型污染键、超深/超大参数结构和超过 500 个模型的目录均被前后端拒绝；`executionReady=false`；现有 `models:bootstrap` 仍只读取本地 `ModelGatewayBridge`。
- **验证证据**：后端 55/55（其中契约 13/13、ArchUnit 4/4）；管理中心 ESLint、TypeScript、Vitest 17/17 和生产构建通过；桌面认证 24/24；本地模型网关 24/24；桌面 Smoke 17/17；Node 语法检查通过。

```xml
<task type="auto">
  <name>锁定模型目录和桌面兼容契约</name>
  <files>后端 DesktopBootstrapResponse/Service；桌面 desktop-auth-client.cjs、model-gateway-bridge.cjs；Wave 2 验收基线</files>
  <action>固定 schemaVersion=1；定义 platform 模型项；确认 Wave 3 不把联网模型混入本地 model-gateway；形成 forbidden fields 清单。</action>
  <verify>契约测试证明旧客户端接受新增 models 数据；豆包和本地网关 API/IPC 列表无变化。</verify>
  <security>检查响应不含凭据、私有 URL、Header、tenantId 输入和内部路径。</security>
  <done>兼容契约和回归白名单被测试固化。</done>
</task>
```

### 节点 3.1：数据库迁移

- **节点状态**：已完成（2026-08-25）。
- **验收结果**：V5/U5、五张表、Ground Truth、JSON/状态/唯一键/复合外键负例、active 厂商规则、发布快照封存不可变、`lingframe_app` 最小权限、U5 单独回滚和 V2-V5 再次全链回归全部通过。
- **验证证据**：隔离 PostgreSQL 16 共 31 个检查组通过；日志 `scripts/log/database-migrations-20260825-042907.log`；正式 `127.0.0.1:5433/lingframe_identity` 未连接、未修改。

```xml
<task type="human-verify">
  <name>创建 model_catalog V5/U5 迁移</name>
  <files>V5、U5、DESIGN.md、README.md、迁移测试脚本与 SQL 断言</files>
  <action>创建五张表、约束、索引、最小权限和不可变快照规则；仅在隔离 PostgreSQL 执行。</action>
  <verify>正向迁移、约束负例、最小权限、U5 回滚和 V2-V5 全链回归全部通过。</verify>
  <security>验证 lingframe_app 无 DDL、无快照硬删除；跨租户 Membership 外键写入被数据库拒绝。</security>
  <done>隔离迁移报告通过；正式 5433 未被修改。</done>
</task>
```

### 节点 3.2：只读后端接口

- **节点状态**：已完成（2026-08-25）。
- **验收结果**：已实现平台厂商、模型、发布版本与版本快照只读查询；当前租户策略只读查询；桌面端有效模型目录查询。`DesktopBootstrapServiceImpl` 与 `/api/v1/desktop/models` 使用同一有效目录服务，并继续保持 `schemaVersion=1`、`source=platform`、`executionReady=false`。
- **安全与隔离**：`tenantId` 只来自 `SessionContext`；Management Web 与 Desktop 终端互斥；A/B 租户隔离通过；方法级权限拒绝统一返回 HTTP 403 + `PERMISSION_DENIED`；桌面响应不包含凭据、私有路由、Header 或内部字段。
- **验证证据**：Spring Boot 全量 75/75（其中模型目录 PostgreSQL/API 集成测试 6/6、ArchUnit 4/4）；OpenAPI 仅暴露节点 3.2 已实现的 GET 接口；隔离 PostgreSQL 16 迁移回归 31/31，日志 `scripts/log/database-migrations-20260825-050026.log`；正式 `127.0.0.1:5433/lingframe_identity` 未连接、未修改。

```xml
<task type="auto">
  <name>实现平台、租户和桌面模型只读查询</name>
  <files>DTO、Service、Repository、Controller 和测试</files>
  <action>先实现 provider/model/version/tenant-model/desktop-model 查询，使用强分层和显式 tenantId Repository 条件。</action>
  <verify>服务单测、Controller 权限测试、PostgreSQL 查询集成测试和 OpenAPI 字段断言。</verify>
  <security>management_web 与 desktop 终端互斥；A/B 租户隔离；响应 forbidden fields 扫描。</security>
  <done>管理端可读目录，桌面端可读有效目录，写操作尚不可用。</done>
</task>
```

### 节点 3.3：管理端只读页面

- **节点状态**：已完成（2026-08-25）。
- **验收结果**：已新增权限驱动的 `/models` 导航与 any-of 路由门禁；平台目录和当前租户策略按各自权限独立显示；提供筛选、分页、三态策略与最终有效状态，并覆盖 loading/empty/error/forbidden。页面不展示参数 Schema、默认参数、内部 ID、内容哈希和 rowVersion，也没有任何写操作。
- **视觉与交互**：1280×800、768×900、390×844 的平台目录与租户策略均完成真实浏览器渲染；小屏表格转换为单层列表，移动侧栏不遮挡退出路径；左右方向键、Home/End 可切换页签，焦点环清晰。
- **验证证据**：管理中心 ESLint、TypeScript、Vitest 28/28、生产构建通过；浏览器成功、错误和移动侧栏状态通过；只读 API 测试证明请求不携带 tenantId。当前 9001 仍为旧运行进程，因此正式数据库成功数据未用于本节点视觉验收；成功场景使用本机临时只读 Mock，验收后已停止并清理，正式 5433 未连接、未修改。

```xml
<task type="human-verify">
  <name>实现模型目录和租户策略只读 UI</name>
  <files>routes、ManagementLayout、features/model-catalog、API/Query/types/tests</files>
  <action>实现权限驱动导航、平台目录表格、当前租户三态展示以及 loading/empty/error/forbidden 状态。</action>
  <verify>Vitest、typecheck、lint、build；1280/768/390 浏览器截图和键盘路径。</verify>
  <security>无权限导航不显示；构造 URL 返回 403；页面和日志不出现敏感字段。</security>
  <done>只读页面可验收，视觉延续 Wave 2 且不拥挤变形。</done>
</task>
```

### 节点 3.4：新增、编辑与启停

- **后端状态**：已完成（2026-08-25）；前端抽屉表单与人工 UI 验收尚未开始。
- **后端验收结果**：已实现厂商/模型 POST、PUT，创建固定为 draft，更新必须携带 rowVersion；Repository 使用 `WHERE id = :id AND row_version = :rowVersion` 原子递增乐观锁；重复厂商/模型代码、非 active 厂商启用模型、存在 active 模型时停用厂商均返回精确业务错误码。
- **安全结果**：所有管理端非安全方法统一校验双提交 CSRF；Controller 与 Service 双重权限/终端复核；请求 DTO 使用字段白名单并拒绝 tenantId/未知字段；参数 Schema 与默认参数限制为 64 KiB、12 层、1000 数组项、200 对象键，并拒绝敏感键、原型污染键和非有限数值。
- **验证证据**：Spring Boot 全量 92/92，写入 PostgreSQL/API 集成 5/5，命令 Service 7/7，契约校验 2/2，CSRF Filter 3/3，ArchUnit 4/4；隔离 PostgreSQL 16 迁移回归 31/31，日志 `scripts/log/database-migrations-20260825-115618.log`；正式 5433 未连接、未修改。

```xml
<task type="human-verify">
  <name>实现厂商和模型草稿维护</name>
  <files>Command Service、Repository Adapter、写 Controller、Vue 抽屉表单和测试</files>
  <action>实现新增、编辑、状态切换、rowVersion 冲突、JSON Schema 校验和未发布变更提示。</action>
  <verify>正常、重复代码、非法 Schema、并发 rowVersion、非 active 厂商启用模型等用例。</verify>
  <security>CSRF、permission、服务端字段白名单、JSON 大小/深度限制、错误信息脱敏。</security>
  <done>草稿可维护，但不会影响当前发布目录。</done>
</task>
```

### 节点 3.5：目录版本发布

**状态：已完成（2026-08-25）**

- 后端已实现 `GET /publish-preview` 与 `POST /versions/publish`，保持 Controller → Service → Repository 分层；发布事务使用 PostgreSQL advisory lock、当前版本与草稿哈希双校验、完整快照封存和 current 原子切换。
- 正式发布强制 `model_catalog.publish`、CSRF 和 `Idempotency-Key`；同键同内容安全重放，同键异内容、预览过期、当前版本冲突和无变化均使用稳定错误码拒绝。
- 管理端 `/models` 已增加权限驱动的“发布目录”入口；预览和确认在同一个响应式抽屉内完成，无变化或 blocker 时禁用发布，409 冲突自动退回并刷新预览，关闭后恢复触发按钮焦点。
- **验证证据**：Spring Boot 全量 100/100，发布 Service 7/7，PostgreSQL/API 发布集成 1/1，ArchUnit 4/4；管理中心 ESLint、TypeScript、Vitest 41/41、生产构建通过；隔离迁移 31/31，日志 `scripts/log/database-migrations-20260825-132657.log`；1280×800、768×900、390×844 浏览器验收无横向溢出、控制台 0 error/warn；正式 5433 未连接、未修改。

```xml
<task type="human-verify">
  <name>实现发布预览与不可变目录版本</name>
  <files>CatalogPublicationService、Repository、发布 API、发布弹窗和并发测试</files>
  <action>计算 diff/hash；在单事务中锁定当前版本、创建新版本快照、切换 current；实现幂等重放。</action>
  <verify>无变化拒绝、重复请求返回同版本、两管理员并发只有一个版本获胜、旧版本内容不漂移。</verify>
  <security>只有 model_catalog.publish 可发布；快照不含敏感字段；异常时事务全部回滚。</security>
  <done>发布后桌面查询原子切换到新版本，失败不出现半版本。</done>
</task>
```

### 节点 3.6：租户模型策略

**状态：已完成（2026-08-25）**

- 后端已实现 `PUT /api/v1/management/tenant-models/{modelId}`，保持 Controller → Service → Repository 分层；tenantId 只取自 SessionContext，请求 DTO 显式拒绝 tenantId 和其他未知字段。
- 支持 `inherit/enabled/hidden` 三态：无策略记录提交 inherit 不创建空记录；首次显式策略使用 `rowVersion=null`；已有策略必须携带最新 rowVersion，条件 UPDATE 原子递增，冲突返回 `TENANT_MODEL_ROW_VERSION_CONFLICT`。
- 策略仅允许作用于当前已发布目录中的稳定 modelId；未发布模型返回 `TENANT_MODEL_NOT_IN_CURRENT_CATALOG`；management_web 写入强制 `tenant_model.manage` 和双提交 CSRF，desktop Token 被拒绝。
- 管理端当前租户页签已增加内联三段策略控制，一次只保存一个模型；只读用户继续显示 Badge。保存、成功、普通失败和冲突均在行内反馈，409 自动刷新，刷新后焦点恢复到刚操作的按钮。
- 写入后 `/api/v1/desktop/models` 与 `/api/v1/desktop/bootstrap` 下一次读取立即反映同一有效目录，继续保持 `schemaVersion=1` 和 `executionReady=false`。
- **验证证据**：后端全量 109/109、租户策略集成 3/3、Command Service 6/6、ArchUnit 4/4；前端四门禁和 Vitest 46/46；隔离迁移 31/31，日志 `scripts/log/database-migrations-20260825-140627.log`；1280×800、768×900、390×844 无页面横向溢出，移动策略按钮 44px，控制台 0 error/warn；正式 5433 未连接、未修改。

```xml
<task type="human-verify">
  <name>实现当前租户 inherit/enabled/hidden</name>
  <files>TenantModelService/Repository/Controller、租户页签和测试</files>
  <action>按 SessionContext tenantId upsert 策略并计算最终有效状态；支持恢复 inherit。</action>
  <verify>A/B 租户正负例、无 tenantId 输入、未知/未发布 modelId、rowVersion 冲突和刷新持久化。</verify>
  <security>tenant_model.manage 权限；数据库复合外键；响应不暴露其他租户策略。</security>
  <done>租户策略只影响当前租户，桌面有效目录立即反映策略。</done>
</task>
```

### 节点 3.7：桌面 bootstrap 联通

**状态：已完成（2026-08-25）**

- 后端 bootstrap 继续固定 `schemaVersion=1`，通过同一 `DesktopModelCatalogService` 返回 `modelCatalog + models`；平台模型保持 `source=platform`、`executionReady=false`，不包含凭据和私有路由。
- 桌面端复用现有 `desktop-bootstrap-cache-v1.json` 安全缓存，不新增第二套目录状态；缓存封套按 `userId + tenantId` 绑定，平台模型和 Skill 元数据进入缓存前统一执行递归白名单、敏感键、深度和容量校验。
- 离线降级只允许网络不可达、连接超时和 HTTP 5xx。身份或 bootstrap 返回 HTTP 200 但契约非法时，客户端清除旧缓存并显式进入不可用状态，不再伪装成离线成功。
- 登出、用户变化、租户变化、进入租户选择和服务端 `/auth/me` 返回租户变化时均清理旧缓存；过期缓存版本在启动读取阶段直接删除。
- 现有 `models:bootstrap` IPC 仍只调用本地 `ModelGatewayBridge.bootstrap()`；平台目录只保存在认证 bootstrap 数据中，豆包和本地模型网关生成选择器零行为变化。
- **验证证据**：桌面认证 30/30、本地模型网关 24/24、桌面 Smoke 17/17、Node 语法检查通过；后端 109/109（DesktopBootstrap Service 14、DesktopModelCatalog Service 4、ArchUnit 4）；管理端四门禁与 Vitest 46/46；隔离迁移 31/31，日志 `scripts/log/database-migrations-20260825-144410.log`；正式 5433 未连接、未修改。

```xml
<task type="human-verify">
  <name>将有效目录加入 bootstrap 并安全缓存</name>
  <files>DesktopBootstrapResponse/Service/Test；桌面 desktop-auth-client.cjs 及契约测试</files>
  <action>保持 schemaVersion=1，新增可选 modelCatalog 元数据并返回 models；桌面缓存平台目录但不合并进本地模型网关选择器。</action>
  <verify>旧 bootstrap 契约、新目录缓存、离线读取、租户切换清缓存、旧客户端忽略新增字段和本地网关不变量。</verify>
  <security>缓存按 userId+tenantId 绑定；登出/换租户不串目录；不缓存凭据。</security>
  <done>桌面端能安全获知目录，但现有生成渠道零行为变化。</done>
</task>
```

### 节点 3.8：全量验收

```xml
<task type="human-verify">
  <name>执行 Wave 3 自动化与浏览器节点验收</name>
  <files>references/wave3-acceptance.json、scripts/run-wave3-acceptance.mjs、scripts/log、后端测试</files>
  <action>执行数据库、后端、前端、真实 API、浏览器和桌面兼容回归。</action>
  <verify>测试报告、API 响应、三视口截图、控制台日志和回归基线。</verify>
  <security>覆盖越权、跨租户、CSRF、敏感字段、并发发布、幂等和缓存串租户反例。</security>
  <done>所有阻塞用例通过，验收 JSON 与日志落盘，才允许进入 Wave 4。</done>
</task>
```

## 11. 测试与验收矩阵

### 数据库

- V2-V5 正向迁移和 U5-U2 逆序回滚。
- JSON object、状态、唯一键、复合外键、单 current 版本约束。
- 发布快照不可 UPDATE/DELETE。
- `lingframe_app` 最小权限。

### 后端

- Service 正常、异常、边界和并发测试。
- Controller `management_web/desktop` 终端隔离。
- A/B 租户正负例。
- 发布幂等、版本冲突和事务回滚。
- Desktop bootstrap 旧契约兼容。
- ArchUnit 强分层门禁。

### 前端

- API 请求不发送 tenantId。
- 路由、侧栏、按钮按 permission 控制。
- 筛选、分页、抽屉表单、Schema 错误、rowVersion 冲突、发布预览。
- loading、empty、error、forbidden、stale 数据刷新。
- 单弹窗、Escape、焦点恢复和键盘操作。

### 真实 E2E

1. 平台管理员新增厂商和视频模型，设为 active。
2. 发布预览显示新增 1 个模型。
3. 发布版本 N，旧版本 N-1 仍可只读查看。
4. 租户 A 设为 enabled，租户 B 保持 inherit 且平台默认 false。
5. A 的 desktop/models 和 bootstrap 返回模型；B 不返回。
6. 将 A 改为 hidden 后立即不再返回。
7. 桌面缓存按租户更新，本地模型网关数据和豆包模型不变化。

## 12. 发布不变量

1. 任意时刻最多一个 current catalog version。
2. 发布版本内容一旦创建永不变化。
3. 草稿修改不会绕过发布直接进入桌面端。
4. 发布要么全部成功，要么全部回滚，没有半版本。
5. 重复 `Idempotency-Key` 不创建第二个版本。
6. `expectedCurrentVersion` 过期时返回 409，不覆盖他人发布。
7. 租户策略只作用于稳定 `modelId`，不复制或修改全局目录。
8. 桌面端永远收不到平台凭据和私有路由。

## 13. 节点验收门禁

每个节点完成后必须同时提供：

- **命令 + 输出**：lint、typecheck、build、Maven/迁移命令和退出码。
- **测试报告**：用例数、通过数、失败清单。
- **API 响应**：状态码、请求权限、关键响应字段。
- **UI 证据**：操作步骤、视口、截图和控制台错误数。
- **回归证据**：Wave 2、桌面登录/bootstrap、豆包与本地模型网关基线没有新增失败。

任一阻塞级失败不得进入下一节点；正式数据库迁移和平台真实模型调用必须另行授权。

## 14. Wave 3 完成定义

Wave 3 完成必须满足：

- V5/U5 在隔离 PostgreSQL 完整通过，正式 5433 未被自动修改。
- 平台管理员可维护并发布目录版本。
- 租户管理员可管理当前租户模型策略。
- 桌面端可通过 bootstrap/desktop/models 获知当前租户有效目录。
- 旧桌面 bootstrap `schemaVersion=1` 兼容。
- 平台模型仍不进入生成选择器，直到平台代理和积分结算实现。
- 后端、前端、真实接口和三视口浏览器验收全部通过。
- 无跨租户、越权、敏感信息泄露和发布并发不变量失败。

## 15. 后续 Wave

- **Wave 4：积分钱包与账本**：钱包、充值订单、追加式流水、模型价格版本、任务预占/结算/释放；完成后再开放平台模型真实代理调用并将 `executionReady` 置为 true。
- **Wave 5：Skill 目录与版本管理**：平台上传、隔离扫描、对象存储、签名、发布、租户授权和桌面受管缓存；依赖模型目录稳定 ID 和版本。
