\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
    IF to_regnamespace('licensing') IS NOT NULL THEN
        RAISE EXCEPTION 'the retired licensing schema must not exist';
    END IF;

    IF NOT has_schema_privilege('lingframe_app', 'identity', 'USAGE') THEN
        RAISE EXCEPTION 'lingframe_app must have identity schema usage';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'identity.roles', 'SELECT')
       OR has_table_privilege('lingframe_app', 'identity.roles', 'INSERT')
       OR has_table_privilege('lingframe_app', 'identity.roles', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'identity.roles', 'DELETE') THEN
        RAISE EXCEPTION 'RBAC catalog privileges are not read-only for lingframe_app';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'identity.users', 'SELECT')
       OR NOT has_table_privilege('lingframe_app', 'identity.users', 'INSERT')
       OR NOT has_table_privilege('lingframe_app', 'identity.users', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'identity.users', 'DELETE') THEN
        RAISE EXCEPTION 'identity.users privileges do not match the soft-state model';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'identity.tenant_invitations', 'INSERT')
       OR NOT has_table_privilege('lingframe_app', 'identity.permission_overrides', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'identity.feature_policies', 'DELETE') THEN
        RAISE EXCEPTION 'access-control table privileges are incorrect';
    END IF;

    IF (SELECT count(*) FROM identity.roles) <> 6 THEN
        RAISE EXCEPTION 'expected exactly six seeded roles';
    END IF;

    IF (SELECT count(*) FROM identity.permissions) <> 41 THEN
        RAISE EXCEPTION 'expected exactly 41 seeded permissions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM identity.permissions
        WHERE code LIKE 'license.%'
           OR code LIKE 'licensing.%'
    ) THEN
        RAISE EXCEPTION 'retired license permissions were seeded';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM identity.roles AS r
        JOIN identity.role_permissions AS rp ON rp.role_id = r.id
        JOIN identity.permissions AS p ON p.id = rp.permission_id
        WHERE r.code = 'platform_admin'
          AND p.client_type <> 'management_web'
    ) THEN
        RAISE EXCEPTION 'platform_admin received desktop permissions';
    END IF;

    IF (SELECT count(*)
        FROM identity.roles AS r
        JOIN identity.role_permissions AS rp ON rp.role_id = r.id
        JOIN identity.permissions AS p ON p.id = rp.permission_id
        WHERE r.code = 'platform_admin') <> 30 THEN
        RAISE EXCEPTION 'platform_admin management permission catalog is incomplete';
    END IF;

    IF (SELECT count(*)
        FROM identity.roles AS r
        JOIN identity.role_permissions AS rp ON rp.role_id = r.id
        JOIN identity.permissions AS p ON p.id = rp.permission_id
        WHERE r.code = 'member'
          AND p.client_type = 'desktop') <> 11 THEN
        RAISE EXCEPTION 'member desktop permission catalog is incomplete';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM identity.roles AS r
        JOIN identity.role_permissions AS rp ON rp.role_id = r.id
        JOIN identity.permissions AS p ON p.id = rp.permission_id
        WHERE r.code IN ('member', 'viewer')
          AND ((r.code = 'member' AND p.client_type = 'management_web')
               OR (r.code = 'viewer' AND p.client_type = 'desktop'))
    ) THEN
        RAISE EXCEPTION 'member/viewer terminal permission domains leaked';
    END IF;
END
$$;

INSERT INTO identity.tenants (id, tenant_code, display_name)
VALUES
    ('30000000-0000-4000-8000-000000000001', 'tenant_alpha', 'Alpha Tenant'),
    ('30000000-0000-4000-8000-000000000002', 'tenant_beta', 'Beta Tenant');

INSERT INTO identity.users (id, username, email, password_hash)
VALUES
    ('40000000-0000-4000-8000-000000000001', 'alice', 'alice@example.test', '$argon2id$alice'),
    ('40000000-0000-4000-8000-000000000002', 'bob', 'bob@example.test', '$argon2id$bob'),
    ('40000000-0000-4000-8000-000000000003', 'platform', 'platform@example.test', '$argon2id$platform');

INSERT INTO identity.tenant_memberships (
    id, tenant_id, user_id, role_id, status, joined_at
)
VALUES
    (
        '50000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        'active', now()
    ),
    (
        '50000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000006',
        'active', now()
    ),
    (
        '50000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000006',
        'active', now()
    );

INSERT INTO identity.platform_role_assignments (
    id, user_id, role_id, granted_by_user_id
)
VALUES (
    '50000000-0000-4000-8000-000000000004',
    '40000000-0000-4000-8000-000000000003',
    '10000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000003'
);

INSERT INTO identity.devices (
    id, tenant_id, client_type, device_hash, fingerprint_version, display_name, trust_status
)
VALUES
    (
        '60000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'desktop', repeat('a', 64), 1, 'Alice Desktop', 'trusted'
    ),
    (
        '60000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000001',
        'management_web', repeat('b', 64), 1, 'Alice Browser', 'trusted'
    ),
    (
        '60000000-0000-4000-8000-000000000003',
        '30000000-0000-4000-8000-000000000002',
        'desktop', repeat('c', 64), 1, 'Bob Desktop', 'trusted'
    );

INSERT INTO identity.user_sessions (
    id, user_id, tenant_id, membership_id, device_id, client_type, expires_at
)
VALUES (
    '70000000-0000-4000-8000-000000000001',
    '40000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    '50000000-0000-4000-8000-000000000001',
    '60000000-0000-4000-8000-000000000001',
    'desktop',
    now() + interval '1 hour'
);

INSERT INTO identity.refresh_tokens (
    id, session_id, family_id, token_hash, expires_at
)
VALUES (
    '80000000-0000-4000-8000-000000000001',
    '70000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    decode(repeat('11', 32), 'hex'),
    now() + interval '7 days'
);

INSERT INTO identity.tenant_invitations (
    id, tenant_id, target_email, role_id, token_hash,
    invited_by_membership_id, expires_at, idempotency_key
)
VALUES (
    '90000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'invitee@example.test',
    '10000000-0000-4000-8000-000000000006',
    decode(repeat('22', 32), 'hex'),
    '50000000-0000-4000-8000-000000000001',
    now() + interval '24 hours',
    'invite-alpha-1'
);

INSERT INTO identity.tenant_selection_tickets (
    id, user_id, token_hash, device_hash, fingerprint_version, client_type, expires_at
)
VALUES
    (
        '91000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        decode(repeat('33', 32), 'hex'),
        repeat('d', 64),
        1,
        'desktop',
        now() + interval '5 minutes'
    ),
    (
        '91000000-0000-4000-8000-000000000002',
        '40000000-0000-4000-8000-000000000001',
        decode(repeat('34', 32), 'hex'),
        repeat('e', 64),
        1,
        'desktop',
        now() + interval '5 minutes'
    );

INSERT INTO identity.tenant_selection_ticket_memberships (
    ticket_id, user_id, membership_id, tenant_id
)
VALUES
    (
        '91000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001'
    ),
    (
        '91000000-0000-4000-8000-000000000001',
        '40000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000002'
    );

INSERT INTO identity.permission_overrides (
    id, tenant_id, target_scope, permission_id, effect, reason,
    created_by_membership_id, idempotency_key
)
VALUES (
    '92000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'tenant',
    '20000000-0000-4000-8000-000000000007',
    'deny',
    'security test',
    '50000000-0000-4000-8000-000000000001',
    'permission-alpha-1'
);

INSERT INTO identity.feature_policies (
    id, tenant_id, target_scope, target_membership_id, feature_code,
    effect, policy, reason, created_by_membership_id, idempotency_key
)
VALUES (
    '93000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000001',
    'membership',
    '50000000-0000-4000-8000-000000000001',
    'creation.video',
    'disable',
    '{"source":"migration-test"}'::jsonb,
    'security test',
    '50000000-0000-4000-8000-000000000001',
    'feature-alpha-1'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO identity.tenant_memberships (
            id, tenant_id, user_id, role_id, status, joined_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            '40000000-0000-4000-8000-000000000002',
            '10000000-0000-4000-8000-000000000001',
            'active', now()
        );
        RAISE EXCEPTION 'platform role was accepted as a tenant Membership role';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.platform_role_assignments (id, user_id, role_id)
        VALUES (
            'a0000000-0000-4000-8000-000000000002',
            '40000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000002'
        );
        RAISE EXCEPTION 'tenant role was accepted as a platform role assignment';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.user_sessions (
            id, user_id, tenant_id, membership_id, device_id, client_type, expires_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000003',
            '40000000-0000-4000-8000-000000000002',
            '30000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            'desktop', now() + interval '1 hour'
        );
        RAISE EXCEPTION 'session accepted a user that does not own the Membership';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.user_sessions (
            id, user_id, tenant_id, membership_id, device_id, client_type, expires_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000004',
            '40000000-0000-4000-8000-000000000001',
            '30000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000001',
            '60000000-0000-4000-8000-000000000001',
            'management_web', now() + interval '1 hour'
        );
        RAISE EXCEPTION 'session client_type did not match the device terminal type';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.refresh_tokens (
            id, session_id, family_id, token_hash, expires_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000005',
            '70000000-0000-4000-8000-000000000001',
            '81000000-0000-4000-8000-000000000001',
            decode(repeat('44', 32), 'hex'),
            now() + interval '7 days'
        );
        RAISE EXCEPTION 'a second active Refresh Token was accepted for one Session';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.tenant_invitations (
            id, tenant_id, role_id, token_hash, invited_by_membership_id, expires_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000006',
            '30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000001',
            decode(repeat('55', 32), 'hex'),
            '50000000-0000-4000-8000-000000000001',
            now() + interval '1 day'
        );
        RAISE EXCEPTION 'tenant invitation accepted a platform role';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.tenant_selection_ticket_memberships (
            ticket_id, user_id, membership_id, tenant_id
        ) VALUES (
            '91000000-0000-4000-8000-000000000002',
            '40000000-0000-4000-8000-000000000001',
            '50000000-0000-4000-8000-000000000003',
            '30000000-0000-4000-8000-000000000002'
        );
        RAISE EXCEPTION 'tenant selection ticket accepted another user Membership';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.permission_overrides (
            id, tenant_id, target_scope, target_membership_id, permission_id,
            effect, reason, created_by_membership_id
        ) VALUES (
            'a0000000-0000-4000-8000-000000000007',
            '30000000-0000-4000-8000-000000000001',
            'membership',
            '50000000-0000-4000-8000-000000000002',
            '20000000-0000-4000-8000-000000000007',
            'deny', 'cross tenant test',
            '50000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'permission override accepted a cross-tenant Membership';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.feature_policies (
            id, tenant_id, target_scope, target_membership_id, feature_code,
            effect, reason, created_by_membership_id
        ) VALUES (
            'a0000000-0000-4000-8000-000000000008',
            '30000000-0000-4000-8000-000000000001',
            'tenant',
            '50000000-0000-4000-8000-000000000001',
            'creation.image',
            'disable', 'invalid target test',
            '50000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'feature policy accepted an inconsistent target scope';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.refresh_tokens (
            id, session_id, family_id, token_hash, expires_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000009',
            '70000000-0000-4000-8000-000000000001',
            '81000000-0000-4000-8000-000000000002',
            decode('abcd', 'hex'),
            now() + interval '7 days'
        );
        RAISE EXCEPTION 'short Refresh Token hash was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO identity.tenant_invitations (
            id, tenant_id, role_id, token_hash, status,
            invited_by_membership_id, expires_at
        ) VALUES (
            'a0000000-0000-4000-8000-000000000010',
            '30000000-0000-4000-8000-000000000001',
            '10000000-0000-4000-8000-000000000006',
            decode(repeat('66', 32), 'hex'),
            'accepted',
            '50000000-0000-4000-8000-000000000001',
            now() + interval '1 day'
        );
        RAISE EXCEPTION 'accepted invitation without acceptor state was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END
$$;

DO $$
BEGIN
    IF (SELECT count(*) FROM identity.tenant_selection_ticket_memberships) <> 2 THEN
        RAISE EXCEPTION 'tenant selection Membership whitelist was not preserved';
    END IF;

    IF (SELECT client_type FROM identity.user_sessions
        WHERE id = '70000000-0000-4000-8000-000000000001') <> 'desktop' THEN
        RAISE EXCEPTION 'desktop Session was not stored with client_type';
    END IF;

    IF (SELECT count(*) FROM identity.permission_overrides WHERE effect = 'deny') <> 1 THEN
        RAISE EXCEPTION 'permission deny override was not stored';
    END IF;

    IF (SELECT count(*) FROM identity.feature_policies WHERE effect = 'disable') <> 1 THEN
        RAISE EXCEPTION 'feature disable policy was not stored';
    END IF;
END
$$;

ROLLBACK;
