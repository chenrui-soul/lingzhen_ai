INSERT INTO identity.tenants (id, tenant_code, display_name)
VALUES
    ('41000000-0000-4000-8000-000000000001', 'billing_a', 'Billing Tenant A'),
    ('41000000-0000-4000-8000-000000000002', 'billing_b', 'Billing Tenant B');

INSERT INTO identity.users (id, username, email, password_hash)
VALUES (
    '42000000-0000-4000-8000-000000000001',
    'billing_fixture',
    'billing-fixture@example.com',
    '$argon2id$billing-fixture'
);

INSERT INTO identity.tenant_memberships (
    id, tenant_id, user_id, role_id, role_scope, status, joined_at
)
VALUES
    (
        '43000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        '42000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000006',
        'tenant', 'active', now()
    ),
    (
        '43000000-0000-4000-8000-000000000002',
        '41000000-0000-4000-8000-000000000002',
        '42000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000006',
        'tenant', 'active', now()
    );

INSERT INTO desktop_data.credit_accounts (id, tenant_id, user_id, balance)
VALUES
    (
        '44000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        '42000000-0000-4000-8000-000000000001',
        125
    ),
    (
        '44000000-0000-4000-8000-000000000002',
        '41000000-0000-4000-8000-000000000002',
        '42000000-0000-4000-8000-000000000001',
        125
    );
