SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'desktop workspace migrations must run as lingframe_owner';
    END IF;
    IF to_regnamespace('desktop_data') IS NOT NULL THEN
        RAISE EXCEPTION 'desktop_data schema already exists';
    END IF;
END
$$;

CREATE SCHEMA desktop_data AUTHORIZATION lingframe_owner;
REVOKE ALL ON SCHEMA desktop_data FROM PUBLIC, lingframe_app;
GRANT USAGE ON SCHEMA desktop_data TO lingframe_app;

CREATE TABLE desktop_data.workspace_snapshots (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    revision bigint NOT NULL DEFAULT 1,
    snapshot jsonb NOT NULL,
    content_hash varchar(64) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspace_snapshots_membership_fk
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES identity.tenant_memberships (tenant_id, user_id),
    CONSTRAINT workspace_snapshots_revision_ck CHECK (revision > 0),
    CONSTRAINT workspace_snapshots_json_ck CHECK (jsonb_typeof(snapshot) = 'object'),
    CONSTRAINT workspace_snapshots_hash_ck CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT workspace_snapshots_tenant_user_uk UNIQUE (tenant_id, user_id)
);

CREATE INDEX workspace_snapshots_updated_idx
    ON desktop_data.workspace_snapshots (tenant_id, updated_at DESC);

CREATE TABLE desktop_data.doubao_account_bindings (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    account_id varchar(80) NOT NULL,
    display_name varchar(100) NOT NULL,
    login_state varchar(24) NOT NULL DEFAULT 'unknown',
    login_summary varchar(300),
    last_checked_at timestamptz,
    status varchar(16) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT doubao_account_bindings_membership_fk
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES identity.tenant_memberships (tenant_id, user_id),
    CONSTRAINT doubao_account_bindings_account_ck
        CHECK (account_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'),
    CONSTRAINT doubao_account_bindings_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT doubao_account_bindings_login_state_ck
        CHECK (login_state IN ('unknown', 'logged_in', 'logged_out', 'verification_required')),
    CONSTRAINT doubao_account_bindings_status_ck CHECK (status IN ('active', 'removed')),
    CONSTRAINT doubao_account_bindings_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT doubao_account_bindings_tenant_user_account_uk
        UNIQUE (tenant_id, user_id, account_id)
);

CREATE INDEX doubao_account_bindings_owner_status_idx
    ON desktop_data.doubao_account_bindings (tenant_id, user_id, status, updated_at DESC);

CREATE TABLE desktop_data.credit_accounts (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    balance bigint NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT credit_accounts_membership_fk
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES identity.tenant_memberships (tenant_id, user_id),
    CONSTRAINT credit_accounts_balance_ck CHECK (balance >= 0),
    CONSTRAINT credit_accounts_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT credit_accounts_tenant_user_uk UNIQUE (tenant_id, user_id)
);

CREATE TABLE desktop_data.published_skills (
    id uuid PRIMARY KEY,
    skill_code varchar(96) NOT NULL,
    display_name varchar(160) NOT NULL,
    version varchar(40) NOT NULL,
    description varchar(500),
    status varchar(16) NOT NULL DEFAULT 'published',
    published_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT published_skills_code_ck CHECK (skill_code ~ '^[a-z][a-z0-9_.-]{2,95}$'),
    CONSTRAINT published_skills_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT published_skills_version_ck CHECK (btrim(version) <> ''),
    CONSTRAINT published_skills_status_ck CHECK (status IN ('published', 'disabled')),
    CONSTRAINT published_skills_code_version_uk UNIQUE (skill_code, version)
);

COMMENT ON SCHEMA desktop_data IS '桌面端按当前租户与当前用户隔离的联网元数据。';
COMMENT ON TABLE desktop_data.workspace_snapshots IS '项目、对话、任务和素材的脱敏元数据快照，不保存本地文件。';
COMMENT ON TABLE desktop_data.doubao_account_bindings IS '豆包账号非敏感摘要；禁止保存 Cookie、partition 或浏览器路径。';
COMMENT ON TABLE desktop_data.credit_accounts IS '当前用户在当前租户的积分余额。';
COMMENT ON TABLE desktop_data.published_skills IS 'Bootstrap 可见的已发布 Skill 元数据，不包含执行包。';

REVOKE ALL ON
    desktop_data.workspace_snapshots,
    desktop_data.doubao_account_bindings,
    desktop_data.credit_accounts,
    desktop_data.published_skills
FROM PUBLIC, lingframe_app;

GRANT SELECT, INSERT, UPDATE ON
    desktop_data.workspace_snapshots,
    desktop_data.doubao_account_bindings
TO lingframe_app;

GRANT SELECT, INSERT ON desktop_data.credit_accounts TO lingframe_app;

GRANT SELECT ON desktop_data.published_skills TO lingframe_app;
