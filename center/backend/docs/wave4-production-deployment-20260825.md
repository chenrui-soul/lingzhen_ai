# Wave 4 正式部署记录

## 摘要

- 部署时间：2026-08-25 19:23—19:29（Asia/Shanghai）。
- 后端端口：固定 `9001`。
- PostgreSQL：固定 `127.0.0.1:5433/lingframe_identity`。
- 迁移顺序：V5 → V6，均由 `lingframe_owner` 在独立事务中执行。

## 回滚资产

- 数据库备份：`backups/lingframe_identity-before-wave4-20260825-192336.dump`
  - 格式：PostgreSQL custom format
  - 大小：89751 bytes
  - 目录条目：189
  - SHA-256：`4D22356F6A4D89A8447C48ED7567F818A43122AE44A6E0C08F01109B27DF0BCB`
- 旧后端：`backups/lingzhen-center-backend-before-wave4-20260825-192336.jar`
  - 大小：197992 bytes
  - SHA-256：`38DD2783314359746CD48E38B1F1E55847BE1F4EC2F4E25E7AE452BA79452FBF`

## 新版本

- JAR SHA-256：`F11E25D8C09BEE419205F0A03CC8C4F7B7D2DE3A7927B09776E39C80A4E45B00`
- 正式 Schema：`identity`、`model_catalog`、`desktop_data`，Owner 均符合迁移契约。
- 应用角色对 `desktop_data.credit_accounts` 只有 SELECT、INSERT，无 UPDATE 权限。

## 验收证据

- 运行配置：15/15。
- Spring Boot：110/110。
- 桌面身份：30/30。
- 桌面烟测：17/17。
- OpenAPI 必需路径：5/5。
- Bootstrap、Workspace Snapshot、豆包账号匿名访问：全部 HTTP 401。
- 当前开发版客户端真实启动后：Workspace Snapshot 1 条、积分账户 1 条。
- Snapshot revision、JSON、content hash、更新时间和 Membership 有效；Token、Cookie、本地路径等敏感内容扫描为 false。
- 新后端日志未发现 relation missing、permission denied 或桌面同步异常。

## 回滚顺序

1. 停止已验证归属的 9001 后端。
2. 若仅回滚 Schema：依次执行 U6、U5。
3. 若需要完整恢复：使用数据库备份恢复 `lingframe_identity`。
4. 将旧 JAR 恢复到 `target/lingzhen-center-backend-0.1.0-SNAPSHOT.jar`。
5. 使用 `scripts/start-backend.ps1` 启动并验证 live/ready。

## 日志

- `scripts/log/wave4-production-maintenance-20260825-192336.log`
