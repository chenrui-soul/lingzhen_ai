# Wave 4：桌面身份、数据联网与 Bootstrap 聚合

## 目标

- 登录会话在 Access Token 到期前自动续期，所有桌面 IPC 使用统一权限门禁。
- 豆包账号同时归属于当前用户和当前租户，跨用户、跨租户不可见、不可调度。
- 项目、对话、任务、素材只同步元数据；本地文件仍以本机为真实来源。
- Bootstrap 在 `schemaVersion=1` 下向后兼容聚合积分、模型、豆包账号、Skill 与最近项目。

## 服务端契约

- `GET /api/v1/desktop/workspace/snapshot`
- `PUT /api/v1/desktop/workspace/snapshot`
- `GET /api/v1/desktop/doubao-accounts`
- `PUT /api/v1/desktop/doubao-accounts/{accountId}`
- `DELETE /api/v1/desktop/doubao-accounts/{accountId}`

`PUT snapshot` 使用 `expectedRevision` 乐观锁。版本不一致返回 HTTP 409 和
`DESKTOP_WORKSPACE_CONFLICT`，客户端不得静默覆盖。

所有 `tenantId`、`userId` 都来自服务端 `SessionContext`。请求体不得携带身份归属字段。

## 数据边界

允许同步：项目、素材、对话、任务的标识、名称、业务状态、时间、模型和结果摘要。

禁止同步：Access/Refresh Token、Cookie、Authorization、API Key、Secret、数据库地址、
浏览器 partition/profile、`file://` 地址、Windows/Unix 绝对路径、素材二进制内容。

快照限制：最大 2 MiB、最大嵌套 12 层、对象最多 5000 个键、数组最多 10000 项。

## 本地兼容

同一租户的首位历史用户继续认领旧目录 `tenants/{tenantId}`，并写入作用域标记；
同租户其他用户使用 `tenants/{tenantId}/users/{userId}`。不搬移、不删除既有数据。

## 失败与恢复

- 网络不可用：继续使用同用户、同租户本地数据和 Bootstrap 缓存。
- 401：自动刷新并仅重试一次；Refresh 被拒绝后清除身份。
- 403：停止联网写入并清除该身份作用域 Bootstrap 缓存。
- 409：保存冲突状态，读取远端版本，等待后续显式合并；不覆盖本地文件。
- 崩溃恢复：本地原子写入仍是主链，云同步使用 debounce；网络失败后 5 秒重试，且不阻断本地保存。
- 豆包账号删除：只有本地注册表产生显式删除事件时才删除云端摘要；空列表同步不等同于批量删除。

## 回滚

- 数据库：由 `U6__drop_desktop_workspace_tables.sql` 删除 Wave 4 schema。
- 桌面端：移除云同步实例和 change listener 后，本地读写链保持原行为。
- 正式数据库不在开发阶段执行迁移；V6 只由 Testcontainers 隔离 PostgreSQL 验证。
