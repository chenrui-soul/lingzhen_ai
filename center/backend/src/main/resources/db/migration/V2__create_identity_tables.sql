SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'identity migrations must run as lingframe_owner';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'identity'
          AND pg_get_userbyid(nspowner) = 'lingframe_owner'
    ) THEN
        RAISE EXCEPTION 'identity schema is missing or has an unexpected owner';
    END IF;
END
$$;

CREATE TABLE identity.tenants (
    id uuid PRIMARY KEY,
    tenant_code varchar(32) NOT NULL,
    display_name varchar(120) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT tenants_code_ck CHECK (tenant_code ~ '^[a-z][a-z0-9_-]{2,31}$'),
    CONSTRAINT tenants_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT tenants_status_ck CHECK (status IN ('active', 'suspended', 'closed')),
    CONSTRAINT tenants_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT tenants_code_uk UNIQUE (tenant_code)
);

CREATE TABLE identity.users (
    id uuid PRIMARY KEY,
    username varchar(64),
    email varchar(320),
    password_hash text NOT NULL,
    password_algorithm varchar(16) NOT NULL DEFAULT 'argon2id',
    status varchar(16) NOT NULL DEFAULT 'active',
    failed_login_count integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    password_changed_at timestamptz NOT NULL DEFAULT now(),
    last_login_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT users_identity_ck CHECK (username IS NOT NULL OR email IS NOT NULL),
    CONSTRAINT users_username_ck CHECK (username IS NULL OR btrim(username) <> ''),
    CONSTRAINT users_email_ck CHECK (email IS NULL OR btrim(email) <> ''),
    CONSTRAINT users_password_hash_ck CHECK (btrim(password_hash) <> ''),
    CONSTRAINT users_password_algorithm_ck CHECK (password_algorithm = 'argon2id'),
    CONSTRAINT users_status_ck CHECK (status IN ('pending', 'active', 'locked', 'disabled')),
    CONSTRAINT users_lock_state_ck CHECK (status = 'locked' OR locked_until IS NULL),
    CONSTRAINT users_failed_login_count_ck CHECK (failed_login_count >= 0),
    CONSTRAINT users_row_version_ck CHECK (row_version >= 0)
);

CREATE UNIQUE INDEX users_username_normalized_ux
    ON identity.users (lower(btrim(username)))
    WHERE username IS NOT NULL;

CREATE UNIQUE INDEX users_email_normalized_ux
    ON identity.users (lower(btrim(email)))
    WHERE email IS NOT NULL;

CREATE INDEX users_status_idx
    ON identity.users (status, created_at DESC);

CREATE TABLE identity.roles (
    id uuid PRIMARY KEY,
    code varchar(64) NOT NULL,
    display_name varchar(120) NOT NULL,
    description text,
    role_scope varchar(16) NOT NULL,
    is_system boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT roles_code_ck CHECK (code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
    CONSTRAINT roles_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT roles_scope_ck CHECK (role_scope IN ('platform', 'tenant')),
    CONSTRAINT roles_code_uk UNIQUE (code),
    CONSTRAINT roles_id_scope_uk UNIQUE (id, role_scope)
);

CREATE TABLE identity.permissions (
    id uuid PRIMARY KEY,
    code varchar(96) NOT NULL,
    display_name varchar(120) NOT NULL,
    description text,
    client_type varchar(24) NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT permissions_code_ck CHECK (code ~ '^[a-z][a-z0-9_.-]{2,95}$'),
    CONSTRAINT permissions_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT permissions_client_type_ck CHECK (client_type IN ('desktop', 'management_web')),
    CONSTRAINT permissions_code_uk UNIQUE (code)
);

CREATE INDEX permissions_client_type_idx
    ON identity.permissions (client_type, code);

CREATE TABLE identity.role_permissions (
    role_id uuid NOT NULL REFERENCES identity.roles (id),
    permission_id uuid NOT NULL REFERENCES identity.permissions (id),
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE identity.tenant_memberships (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    user_id uuid NOT NULL REFERENCES identity.users (id),
    role_id uuid NOT NULL,
    role_scope varchar(16) NOT NULL DEFAULT 'tenant',
    status varchar(16) NOT NULL DEFAULT 'active',
    joined_at timestamptz,
    removed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT tenant_memberships_role_fk
        FOREIGN KEY (role_id, role_scope) REFERENCES identity.roles (id, role_scope),
    CONSTRAINT tenant_memberships_role_scope_ck CHECK (role_scope = 'tenant'),
    CONSTRAINT tenant_memberships_status_ck CHECK (status IN ('invited', 'active', 'suspended', 'removed')),
    CONSTRAINT tenant_memberships_joined_state_ck CHECK (
        (status = 'invited' AND joined_at IS NULL)
        OR (status <> 'invited' AND joined_at IS NOT NULL)
    ),
    CONSTRAINT tenant_memberships_removed_state_ck CHECK (
        (status = 'removed' AND removed_at IS NOT NULL)
        OR (status <> 'removed' AND removed_at IS NULL)
    ),
    CONSTRAINT tenant_memberships_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT tenant_memberships_tenant_user_uk UNIQUE (tenant_id, user_id),
    CONSTRAINT tenant_memberships_id_tenant_uk UNIQUE (id, tenant_id),
    CONSTRAINT tenant_memberships_id_tenant_user_uk UNIQUE (id, tenant_id, user_id)
);

CREATE INDEX tenant_memberships_user_idx
    ON identity.tenant_memberships (user_id, status);

CREATE INDEX tenant_memberships_tenant_idx
    ON identity.tenant_memberships (tenant_id, status, created_at DESC);

CREATE TABLE identity.platform_role_assignments (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES identity.users (id),
    role_id uuid NOT NULL,
    role_scope varchar(16) NOT NULL DEFAULT 'platform',
    status varchar(16) NOT NULL DEFAULT 'active',
    granted_by_user_id uuid REFERENCES identity.users (id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT platform_role_assignments_role_fk
        FOREIGN KEY (role_id, role_scope) REFERENCES identity.roles (id, role_scope),
    CONSTRAINT platform_role_assignments_scope_ck CHECK (role_scope = 'platform'),
    CONSTRAINT platform_role_assignments_status_ck CHECK (status IN ('active', 'revoked')),
    CONSTRAINT platform_role_assignments_revoked_state_ck CHECK (
        (status = 'active' AND revoked_at IS NULL AND revoked_reason IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND btrim(revoked_reason) <> '')
    ),
    CONSTRAINT platform_role_assignments_row_version_ck CHECK (row_version >= 0)
);

CREATE UNIQUE INDEX platform_role_assignments_active_ux
    ON identity.platform_role_assignments (user_id, role_id)
    WHERE status = 'active';

CREATE INDEX platform_role_assignments_user_idx
    ON identity.platform_role_assignments (user_id, status, granted_at DESC);

CREATE TABLE identity.devices (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    client_type varchar(24) NOT NULL,
    device_hash varchar(64) NOT NULL,
    fingerprint_version smallint NOT NULL,
    display_name varchar(160),
    platform varchar(32),
    architecture varchar(32),
    app_version varchar(32),
    trust_status varchar(16) NOT NULL DEFAULT 'unknown',
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    blocked_at timestamptz,
    blocked_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT devices_client_type_ck CHECK (client_type IN ('desktop', 'management_web')),
    CONSTRAINT devices_hash_ck CHECK (device_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT devices_fingerprint_version_ck CHECK (fingerprint_version > 0),
    CONSTRAINT devices_trust_status_ck CHECK (trust_status IN ('unknown', 'trusted', 'blocked')),
    CONSTRAINT devices_blocked_state_ck CHECK (
        (trust_status = 'blocked' AND blocked_at IS NOT NULL AND btrim(blocked_reason) <> '')
        OR (trust_status <> 'blocked' AND blocked_at IS NULL AND blocked_reason IS NULL)
    ),
    CONSTRAINT devices_seen_order_ck CHECK (last_seen_at >= first_seen_at),
    CONSTRAINT devices_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT devices_tenant_client_hash_uk UNIQUE (tenant_id, client_type, device_hash),
    CONSTRAINT devices_id_tenant_client_uk UNIQUE (id, tenant_id, client_type)
);

CREATE INDEX devices_tenant_trust_idx
    ON identity.devices (tenant_id, client_type, trust_status, last_seen_at DESC);

CREATE TABLE identity.user_sessions (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES identity.users (id),
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    membership_id uuid NOT NULL,
    device_id uuid NOT NULL,
    client_type varchar(24) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    revoked_reason varchar(500),
    client_ip inet,
    user_agent varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT user_sessions_membership_fk
        FOREIGN KEY (membership_id, tenant_id, user_id)
        REFERENCES identity.tenant_memberships (id, tenant_id, user_id),
    CONSTRAINT user_sessions_device_fk
        FOREIGN KEY (device_id, tenant_id, client_type)
        REFERENCES identity.devices (id, tenant_id, client_type),
    CONSTRAINT user_sessions_client_type_ck CHECK (client_type IN ('desktop', 'management_web')),
    CONSTRAINT user_sessions_status_ck CHECK (status IN ('active', 'revoked')),
    CONSTRAINT user_sessions_expiry_ck CHECK (expires_at > issued_at),
    CONSTRAINT user_sessions_seen_ck CHECK (last_seen_at >= issued_at),
    CONSTRAINT user_sessions_revoked_state_ck CHECK (
        (status = 'active' AND revoked_at IS NULL AND revoked_reason IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND btrim(revoked_reason) <> '')
    ),
    CONSTRAINT user_sessions_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT user_sessions_id_tenant_uk UNIQUE (id, tenant_id)
);

CREATE INDEX user_sessions_membership_idx
    ON identity.user_sessions (membership_id, status, expires_at DESC);

CREATE INDEX user_sessions_user_idx
    ON identity.user_sessions (user_id, status, expires_at DESC);

CREATE INDEX user_sessions_device_idx
    ON identity.user_sessions (device_id, status, expires_at DESC);

CREATE INDEX user_sessions_expiry_idx
    ON identity.user_sessions (expires_at)
    WHERE status = 'active';

CREATE TABLE identity.refresh_tokens (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL REFERENCES identity.user_sessions (id),
    family_id uuid NOT NULL,
    parent_token_id uuid,
    token_hash bytea NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    issued_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    revoke_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT refresh_tokens_id_family_uk UNIQUE (id, family_id),
    CONSTRAINT refresh_tokens_parent_fk
        FOREIGN KEY (parent_token_id, family_id)
        REFERENCES identity.refresh_tokens (id, family_id),
    CONSTRAINT refresh_tokens_hash_ck CHECK (octet_length(token_hash) = 32),
    CONSTRAINT refresh_tokens_status_ck CHECK (status IN ('active', 'rotated', 'revoked', 'reused')),
    CONSTRAINT refresh_tokens_expiry_ck CHECK (expires_at > issued_at),
    CONSTRAINT refresh_tokens_state_ck CHECK (
        (status = 'active' AND consumed_at IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'rotated' AND consumed_at IS NOT NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND btrim(revoke_reason) <> '')
        OR (status = 'reused' AND consumed_at IS NOT NULL AND revoked_at IS NOT NULL AND btrim(revoke_reason) <> '')
    ),
    CONSTRAINT refresh_tokens_hash_uk UNIQUE (token_hash)
);

CREATE UNIQUE INDEX refresh_tokens_one_active_per_session_ux
    ON identity.refresh_tokens (session_id)
    WHERE status = 'active';

CREATE INDEX refresh_tokens_family_idx
    ON identity.refresh_tokens (family_id, status, issued_at DESC);

CREATE INDEX refresh_tokens_expiry_idx
    ON identity.refresh_tokens (expires_at)
    WHERE status = 'active';

COMMENT ON TABLE identity.tenants IS '租户边界；所有联网业务数据最终归属一个租户。';
COMMENT ON TABLE identity.users IS '全局用户身份；密码仅保存 Argon2id 哈希。';
COMMENT ON TABLE identity.roles IS '系统角色目录；platform 与 tenant 角色通过 role_scope 硬隔离。';
COMMENT ON TABLE identity.permissions IS '权限目录；client_type 标识权限所属终端域。';
COMMENT ON TABLE identity.tenant_memberships IS '用户加入租户后的单一租户角色和成员状态。';
COMMENT ON TABLE identity.platform_role_assignments IS '平台全局角色分配；不复用租户 Membership。';
COMMENT ON TABLE identity.devices IS '终端设备摘要；不保存原始硬件证据，也不绑定单个用户。';
COMMENT ON TABLE identity.user_sessions IS '绑定用户、租户、Membership、设备和 client_type 的正式会话。';
COMMENT ON TABLE identity.refresh_tokens IS '只保存 Refresh Token 哈希和同 family 轮换链。';

REVOKE ALL ON
    identity.tenants,
    identity.users,
    identity.roles,
    identity.permissions,
    identity.role_permissions,
    identity.tenant_memberships,
    identity.platform_role_assignments,
    identity.devices,
    identity.user_sessions,
    identity.refresh_tokens
FROM PUBLIC, lingframe_app;

GRANT SELECT, INSERT, UPDATE ON
    identity.tenants,
    identity.users,
    identity.tenant_memberships,
    identity.platform_role_assignments,
    identity.devices,
    identity.user_sessions,
    identity.refresh_tokens
TO lingframe_app;

GRANT SELECT ON
    identity.roles,
    identity.permissions,
    identity.role_permissions
TO lingframe_app;
