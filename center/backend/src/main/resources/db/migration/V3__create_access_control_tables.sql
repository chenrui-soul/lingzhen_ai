SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'access control migrations must run as lingframe_owner';
    END IF;
END
$$;

CREATE TABLE identity.tenant_invitations (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    target_email varchar(320),
    role_id uuid NOT NULL,
    role_scope varchar(16) NOT NULL DEFAULT 'tenant',
    token_hash bytea NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    invited_by_membership_id uuid NOT NULL,
    accepted_by_membership_id uuid,
    expires_at timestamptz NOT NULL,
    accepted_at timestamptz,
    revoked_at timestamptz,
    revoke_reason varchar(500),
    idempotency_key varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT tenant_invitations_role_fk
        FOREIGN KEY (role_id, role_scope) REFERENCES identity.roles (id, role_scope),
    CONSTRAINT tenant_invitations_inviter_fk
        FOREIGN KEY (invited_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT tenant_invitations_acceptor_fk
        FOREIGN KEY (accepted_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT tenant_invitations_scope_ck CHECK (role_scope = 'tenant'),
    CONSTRAINT tenant_invitations_email_ck
        CHECK (target_email IS NULL OR btrim(target_email) <> ''),
    CONSTRAINT tenant_invitations_hash_ck CHECK (octet_length(token_hash) = 32),
    CONSTRAINT tenant_invitations_status_ck
        CHECK (status IN ('pending', 'accepted', 'expired', 'revoked')),
    CONSTRAINT tenant_invitations_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT tenant_invitations_state_ck CHECK (
        (status = 'pending' AND accepted_by_membership_id IS NULL AND accepted_at IS NULL
            AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'accepted' AND accepted_by_membership_id IS NOT NULL AND accepted_at IS NOT NULL
            AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'expired' AND accepted_by_membership_id IS NULL AND accepted_at IS NULL
            AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND accepted_by_membership_id IS NULL AND accepted_at IS NULL
            AND revoked_at IS NOT NULL AND btrim(revoke_reason) <> '')
    ),
    CONSTRAINT tenant_invitations_idempotency_ck
        CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> ''),
    CONSTRAINT tenant_invitations_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT tenant_invitations_token_hash_uk UNIQUE (token_hash)
);

CREATE UNIQUE INDEX tenant_invitations_idempotency_ux
    ON identity.tenant_invitations (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX tenant_invitations_pending_email_ux
    ON identity.tenant_invitations (tenant_id, lower(btrim(target_email)))
    WHERE target_email IS NOT NULL AND status = 'pending';

CREATE INDEX tenant_invitations_tenant_status_idx
    ON identity.tenant_invitations (tenant_id, status, created_at DESC);

CREATE INDEX tenant_invitations_expiry_idx
    ON identity.tenant_invitations (expires_at)
    WHERE status = 'pending';

CREATE TABLE identity.tenant_selection_tickets (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES identity.users (id),
    token_hash bytea NOT NULL,
    device_hash varchar(64) NOT NULL,
    fingerprint_version smallint NOT NULL,
    client_type varchar(24) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    expires_at timestamptz NOT NULL,
    consumed_at timestamptz,
    revoked_at timestamptz,
    revoke_reason varchar(500),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_selection_tickets_id_user_uk UNIQUE (id, user_id),
    CONSTRAINT tenant_selection_tickets_hash_ck CHECK (octet_length(token_hash) = 32),
    CONSTRAINT tenant_selection_tickets_device_hash_ck
        CHECK (device_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT tenant_selection_tickets_fingerprint_version_ck CHECK (fingerprint_version > 0),
    CONSTRAINT tenant_selection_tickets_client_type_ck
        CHECK (client_type IN ('desktop', 'management_web')),
    CONSTRAINT tenant_selection_tickets_status_ck
        CHECK (status IN ('pending', 'consumed', 'revoked')),
    CONSTRAINT tenant_selection_tickets_expiry_ck CHECK (expires_at > created_at),
    CONSTRAINT tenant_selection_tickets_state_ck CHECK (
        (status = 'pending' AND consumed_at IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'consumed' AND consumed_at IS NOT NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND consumed_at IS NULL AND revoked_at IS NOT NULL AND btrim(revoke_reason) <> '')
    ),
    CONSTRAINT tenant_selection_tickets_token_hash_uk UNIQUE (token_hash)
);

CREATE INDEX tenant_selection_tickets_user_idx
    ON identity.tenant_selection_tickets (user_id, status, expires_at DESC);

CREATE INDEX tenant_selection_tickets_expiry_idx
    ON identity.tenant_selection_tickets (expires_at)
    WHERE status = 'pending';

CREATE TABLE identity.tenant_selection_ticket_memberships (
    ticket_id uuid NOT NULL,
    user_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT tenant_selection_ticket_memberships_ticket_fk
        FOREIGN KEY (ticket_id, user_id)
        REFERENCES identity.tenant_selection_tickets (id, user_id),
    CONSTRAINT tenant_selection_ticket_memberships_membership_fk
        FOREIGN KEY (membership_id, tenant_id, user_id)
        REFERENCES identity.tenant_memberships (id, tenant_id, user_id),
    PRIMARY KEY (ticket_id, membership_id),
    CONSTRAINT tenant_selection_ticket_memberships_ticket_tenant_uk
        UNIQUE (ticket_id, tenant_id)
);

CREATE INDEX tenant_selection_ticket_memberships_user_idx
    ON identity.tenant_selection_ticket_memberships (user_id, ticket_id);

CREATE TABLE identity.permission_overrides (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    target_scope varchar(16) NOT NULL,
    target_membership_id uuid,
    permission_id uuid NOT NULL REFERENCES identity.permissions (id),
    effect varchar(8) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    reason varchar(500) NOT NULL,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    created_by_membership_id uuid NOT NULL,
    revoked_by_membership_id uuid,
    revoked_at timestamptz,
    revoke_reason varchar(500),
    idempotency_key varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT permission_overrides_target_membership_fk
        FOREIGN KEY (target_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT permission_overrides_creator_fk
        FOREIGN KEY (created_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT permission_overrides_revoker_fk
        FOREIGN KEY (revoked_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT permission_overrides_target_scope_ck
        CHECK (target_scope IN ('tenant', 'membership')),
    CONSTRAINT permission_overrides_target_ck CHECK (
        (target_scope = 'tenant' AND target_membership_id IS NULL)
        OR (target_scope = 'membership' AND target_membership_id IS NOT NULL)
    ),
    CONSTRAINT permission_overrides_effect_ck CHECK (effect IN ('allow', 'deny')),
    CONSTRAINT permission_overrides_status_ck CHECK (status IN ('active', 'revoked')),
    CONSTRAINT permission_overrides_reason_ck CHECK (btrim(reason) <> ''),
    CONSTRAINT permission_overrides_validity_ck
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT permission_overrides_state_ck CHECK (
        (status = 'active' AND revoked_by_membership_id IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND revoked_by_membership_id IS NOT NULL
            AND revoked_at IS NOT NULL AND btrim(revoke_reason) <> '')
    ),
    CONSTRAINT permission_overrides_idempotency_ck
        CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> ''),
    CONSTRAINT permission_overrides_row_version_ck CHECK (row_version >= 0)
);

CREATE UNIQUE INDEX permission_overrides_active_target_ux
    ON identity.permission_overrides (
        tenant_id,
        target_scope,
        COALESCE(target_membership_id, '00000000-0000-0000-0000-000000000000'::uuid),
        permission_id
    )
    WHERE status = 'active';

CREATE UNIQUE INDEX permission_overrides_idempotency_ux
    ON identity.permission_overrides (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX permission_overrides_effective_idx
    ON identity.permission_overrides (tenant_id, status, valid_from, valid_until);

CREATE TABLE identity.feature_policies (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    target_scope varchar(16) NOT NULL,
    target_membership_id uuid,
    feature_code varchar(96) NOT NULL,
    effect varchar(8) NOT NULL,
    policy jsonb NOT NULL DEFAULT '{}'::jsonb,
    status varchar(16) NOT NULL DEFAULT 'active',
    reason varchar(500) NOT NULL,
    valid_from timestamptz NOT NULL DEFAULT now(),
    valid_until timestamptz,
    created_by_membership_id uuid NOT NULL,
    revoked_by_membership_id uuid,
    revoked_at timestamptz,
    revoke_reason varchar(500),
    idempotency_key varchar(128),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT feature_policies_target_membership_fk
        FOREIGN KEY (target_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT feature_policies_creator_fk
        FOREIGN KEY (created_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT feature_policies_revoker_fk
        FOREIGN KEY (revoked_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT feature_policies_target_scope_ck
        CHECK (target_scope IN ('tenant', 'membership')),
    CONSTRAINT feature_policies_target_ck CHECK (
        (target_scope = 'tenant' AND target_membership_id IS NULL)
        OR (target_scope = 'membership' AND target_membership_id IS NOT NULL)
    ),
    CONSTRAINT feature_policies_code_ck
        CHECK (feature_code ~ '^[a-z][a-z0-9_.-]{2,95}$'),
    CONSTRAINT feature_policies_effect_ck CHECK (effect IN ('enable', 'disable')),
    CONSTRAINT feature_policies_json_ck CHECK (jsonb_typeof(policy) = 'object'),
    CONSTRAINT feature_policies_status_ck CHECK (status IN ('active', 'revoked')),
    CONSTRAINT feature_policies_reason_ck CHECK (btrim(reason) <> ''),
    CONSTRAINT feature_policies_validity_ck
        CHECK (valid_until IS NULL OR valid_until > valid_from),
    CONSTRAINT feature_policies_state_ck CHECK (
        (status = 'active' AND revoked_by_membership_id IS NULL AND revoked_at IS NULL AND revoke_reason IS NULL)
        OR (status = 'revoked' AND revoked_by_membership_id IS NOT NULL
            AND revoked_at IS NOT NULL AND btrim(revoke_reason) <> '')
    ),
    CONSTRAINT feature_policies_idempotency_ck
        CHECK (idempotency_key IS NULL OR btrim(idempotency_key) <> ''),
    CONSTRAINT feature_policies_row_version_ck CHECK (row_version >= 0)
);

CREATE UNIQUE INDEX feature_policies_active_target_ux
    ON identity.feature_policies (
        tenant_id,
        target_scope,
        COALESCE(target_membership_id, '00000000-0000-0000-0000-000000000000'::uuid),
        feature_code
    )
    WHERE status = 'active';

CREATE UNIQUE INDEX feature_policies_idempotency_ux
    ON identity.feature_policies (tenant_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX feature_policies_effective_idx
    ON identity.feature_policies (tenant_id, status, valid_from, valid_until);

COMMENT ON TABLE identity.tenant_invitations IS '租户邀请；只保存一次性邀请票据哈希。';
COMMENT ON TABLE identity.tenant_selection_tickets IS '多租户登录的一次性选择票据；消费前不创建正式 Session。';
COMMENT ON TABLE identity.tenant_selection_ticket_memberships IS '租户选择票据允许选择的有效 Membership 白名单。';
COMMENT ON TABLE identity.permission_overrides IS '租户或 Membership 级 permission allow/deny 覆盖；deny 由应用层优先。';
COMMENT ON TABLE identity.feature_policies IS '租户或 Membership 级功能启停与范围策略。';

REVOKE ALL ON
    identity.tenant_invitations,
    identity.tenant_selection_tickets,
    identity.tenant_selection_ticket_memberships,
    identity.permission_overrides,
    identity.feature_policies
FROM PUBLIC, lingframe_app;

GRANT SELECT, INSERT, UPDATE ON
    identity.tenant_invitations,
    identity.tenant_selection_tickets,
    identity.permission_overrides,
    identity.feature_policies
TO lingframe_app;

GRANT SELECT, INSERT ON
    identity.tenant_selection_ticket_memberships
TO lingframe_app;
