# 数据库表结构

`lingzhen_identity_schema.sql` 是从正式 PostgreSQL 数据库导出的结构快照，仅包含：

- schema、表、索引、约束
- 函数和触发器
- 不包含业务数据
- 不包含数据库密码、API 密钥或 Token

日常升级仍以 `center/backend/src/main/resources/db/migration/V*.sql` 为准；本文件用于快速查看完整表结构和初始化新环境。
