# 灵帧统一身份数据库

本目录定义灵帧桌面端与统一联网中心共用的 PostgreSQL 基础设施。用户账号、租户 Membership 和角色权限是新平台唯一准入体系。

## 固定连接约定

- PostgreSQL 版本：16
- 宿主机地址：`127.0.0.1`
- 宿主机端口：`5433`
- 容器端口：`5432`
- 数据库：`lingframe_identity`
- 所有者角色：`lingframe_owner`
- 应用角色：`lingframe_app`
- 容器：`lingframe-license-postgres`
- 持久卷：`lingframe_license_postgres_data`

容器和持久卷名称中的 `license` 是已部署基础设施的历史标识，为避免误接新卷暂不改名；它不表示数据库继续提供密钥认证。

宿主机端口 `5433` 是不可变的项目约定。不要将它改成环境变量，不要增加端口自动探测或自动递增逻辑。端口被占用时应启动失败并明确提示，由运维人员释放 `5433`。

## 启动

```powershell
docker compose up -d
```

## 停止

```powershell
docker compose stop
```

停止或普通 `docker compose down` 不会删除数据库卷。除非已经完成可恢复备份并明确确认，否则不要执行 `docker compose down -v`。

## 配置安全

- 实际密码位于本地 `.env.postgres`，不得提交版本库。
- `.env.postgres.example` 只保留字段说明，不包含真实密码。
- 桌面客户端禁止直连 PostgreSQL；后续只能通过固定 `9001` 的统一联网中心 API 访问在线数据。
- 豆包 Cookie、Chrome Profile 和本地媒体文件禁止上传到本数据库。

## 初始化内容

- schema：`identity`、`workspace`、`sync`、`audit`
- 迁移表：`public.schema_migrations`
- 非敏感服务元数据：`public.service_metadata`
- 应用角色默认只有业务 schema 的 DML 权限，没有建库、建角色和建表权限

现有 `data/license-center.json` 不会在此阶段迁移或修改，其中的密钥、激活、Grant 和租约数据不进入新平台权限体系。

## 版本化业务迁移

身份与访问控制表的 Flyway 脚本位于：

`lingzhen_center_backend/src/main/resources/db/migration/`

V2—V4 身份与权限迁移链已经完成重写，并在不映射宿主机端口的临时 PostgreSQL 16 容器中通过正向迁移、复合外键、终端隔离、RBAC 分域、最小权限负例和逆序回滚验证。该迁移链尚未应用当前 `lingframe_identity`；必须先备份正式数据库并进入单独维护窗口，才能执行正式迁移。
