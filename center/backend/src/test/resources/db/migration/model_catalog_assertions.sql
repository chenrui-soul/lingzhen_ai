\set ON_ERROR_STOP on

BEGIN;

DO $$
DECLARE
    table_name text;
BEGIN
    IF to_regnamespace('model_catalog') IS NULL THEN
        RAISE EXCEPTION 'model_catalog schema was not created';
    END IF;

    IF (SELECT pg_get_userbyid(nspowner)
        FROM pg_namespace
        WHERE nspname = 'model_catalog') <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'model_catalog schema owner is incorrect';
    END IF;

    FOREACH table_name IN ARRAY ARRAY[
        'providers',
        'models',
        'catalog_versions',
        'catalog_version_items',
        'tenant_models'
    ]
    LOOP
        IF to_regclass(format('model_catalog.%I', table_name)) IS NULL THEN
            RAISE EXCEPTION 'missing model_catalog table: %', table_name;
        END IF;

        IF (
            SELECT tableowner
            FROM pg_tables
            WHERE schemaname = 'model_catalog'
              AND tablename = table_name
        ) <> 'lingframe_owner' THEN
            RAISE EXCEPTION 'unexpected owner for model_catalog.%', table_name;
        END IF;
    END LOOP;

    IF NOT has_schema_privilege('lingframe_app', 'model_catalog', 'USAGE')
       OR has_schema_privilege('lingframe_app', 'model_catalog', 'CREATE') THEN
        RAISE EXCEPTION 'model_catalog schema privileges are incorrect';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'model_catalog.providers', 'SELECT')
       OR NOT has_table_privilege('lingframe_app', 'model_catalog.providers', 'INSERT')
       OR NOT has_table_privilege('lingframe_app', 'model_catalog.providers', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'model_catalog.providers', 'DELETE') THEN
        RAISE EXCEPTION 'provider catalog privileges are incorrect';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'model_catalog.catalog_versions', 'SELECT')
       OR NOT has_table_privilege('lingframe_app', 'model_catalog.catalog_versions', 'INSERT')
       OR has_table_privilege('lingframe_app', 'model_catalog.catalog_versions', 'DELETE')
       OR NOT has_column_privilege('lingframe_app', 'model_catalog.catalog_versions', 'is_current', 'UPDATE')
       OR NOT has_column_privilege('lingframe_app', 'model_catalog.catalog_versions', 'published_at', 'UPDATE')
       OR has_column_privilege('lingframe_app', 'model_catalog.catalog_versions', 'content_hash', 'UPDATE') THEN
        RAISE EXCEPTION 'catalog version privileges are not column-minimal';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'model_catalog.catalog_version_items', 'SELECT')
       OR NOT has_table_privilege('lingframe_app', 'model_catalog.catalog_version_items', 'INSERT')
       OR has_table_privilege('lingframe_app', 'model_catalog.catalog_version_items', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'model_catalog.catalog_version_items', 'DELETE') THEN
        RAISE EXCEPTION 'catalog snapshot privileges are incorrect';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_indexes
        WHERE schemaname = 'model_catalog'
          AND indexname = 'catalog_versions_one_current_ux'
    ) THEN
        RAISE EXCEPTION 'single-current catalog version index is missing';
    END IF;
END
$$;

INSERT INTO identity.tenants (id, tenant_code, display_name)
VALUES
    ('31000000-0000-4000-8000-000000000001', 'catalog_alpha', 'Catalog Alpha'),
    ('31000000-0000-4000-8000-000000000002', 'catalog_beta', 'Catalog Beta');

INSERT INTO identity.users (id, username, email, password_hash)
VALUES
    ('41000000-0000-4000-8000-000000000001', 'catalog-admin', 'catalog-admin@example.test', '$argon2id$catalog-admin'),
    ('41000000-0000-4000-8000-000000000002', 'catalog-other', 'catalog-other@example.test', '$argon2id$catalog-other');

INSERT INTO identity.tenant_memberships (
    id, tenant_id, user_id, role_id, status, joined_at
)
VALUES
    (
        '51000000-0000-4000-8000-000000000001',
        '31000000-0000-4000-8000-000000000001',
        '41000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000002',
        'active', now()
    ),
    (
        '51000000-0000-4000-8000-000000000002',
        '31000000-0000-4000-8000-000000000002',
        '41000000-0000-4000-8000-000000000002',
        '10000000-0000-4000-8000-000000000002',
        'active', now()
    );

INSERT INTO model_catalog.providers (
    id, provider_code, display_name, protocol_family, status
)
VALUES
    (
        '61000000-0000-4000-8000-000000000001',
        'lingzhen', 'LingZhen Platform', 'custom_proxy', 'active'
    ),
    (
        '61000000-0000-4000-8000-000000000002',
        'inactive_provider', 'Inactive Provider', 'openai_compatible', 'inactive'
    );

INSERT INTO model_catalog.models (
    id, provider_id, model_code, display_name, capability_type,
    parameter_schema, default_parameters, sort_order, status
)
VALUES
    (
        '71000000-0000-4000-8000-000000000001',
        '61000000-0000-4000-8000-000000000001',
        'seedance-2.0-fast', 'Seedance 2.0 Fast', 'video',
        '{"type":"object","properties":{"duration":{"type":"integer"}}}'::jsonb,
        '{"duration":10}'::jsonb,
        10, 'active'
    ),
    (
        '71000000-0000-4000-8000-000000000002',
        '61000000-0000-4000-8000-000000000001',
        'draft-image-model', 'Draft Image Model', 'image',
        '{}'::jsonb, '{}'::jsonb, 20, 'draft'
    );

INSERT INTO model_catalog.catalog_versions (
    id, version_no, content_hash, idempotency_key,
    published_by_user_id, published_by_membership_id
)
VALUES (
    '81000000-0000-4000-8000-000000000001',
    1,
    repeat('a', 64),
    'catalog-publish-1',
    '41000000-0000-4000-8000-000000000001',
    '51000000-0000-4000-8000-000000000001'
);

INSERT INTO model_catalog.catalog_version_items (
    id, catalog_version_id, model_id, provider_id,
    provider_code, provider_display_name, provider_protocol_family,
    model_code, display_name, capability_type, description,
    parameter_schema, default_parameters, default_tenant_enabled, sort_order
)
SELECT
    '91000000-0000-4000-8000-000000000001',
    '81000000-0000-4000-8000-000000000001',
    model.id,
    provider.id,
    provider.provider_code,
    provider.display_name,
    provider.protocol_family,
    model.model_code,
    model.display_name,
    model.capability_type,
    model.description,
    model.parameter_schema,
    model.default_parameters,
    model.default_tenant_enabled,
    model.sort_order
FROM model_catalog.models AS model
JOIN model_catalog.providers AS provider ON provider.id = model.provider_id
WHERE model.id = '71000000-0000-4000-8000-000000000001';

UPDATE model_catalog.catalog_versions
SET published_at = now(),
    is_current = true
WHERE id = '81000000-0000-4000-8000-000000000001';

SET CONSTRAINTS ALL IMMEDIATE;
SET CONSTRAINTS ALL DEFERRED;

INSERT INTO model_catalog.tenant_models (
    id, tenant_id, model_id, policy, updated_by_membership_id
)
VALUES (
    'a1000000-0000-4000-8000-000000000001',
    '31000000-0000-4000-8000-000000000001',
    '71000000-0000-4000-8000-000000000001',
    'enabled',
    '51000000-0000-4000-8000-000000000001'
);

DO $$
BEGIN
    IF (SELECT default_tenant_enabled
        FROM model_catalog.models
        WHERE id = '71000000-0000-4000-8000-000000000001') THEN
        RAISE EXCEPTION 'new model default_tenant_enabled must be false';
    END IF;

    IF (SELECT count(*) FROM model_catalog.catalog_versions WHERE is_current) <> 1 THEN
        RAISE EXCEPTION 'expected exactly one current catalog version';
    END IF;

    IF (SELECT count(*) FROM model_catalog.catalog_version_items) <> 1 THEN
        RAISE EXCEPTION 'published catalog snapshot was not stored';
    END IF;
END
$$;

DO $$
BEGIN
    BEGIN
        INSERT INTO model_catalog.providers (
            id, provider_code, display_name, protocol_family, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000001',
            'bad_protocol', 'Bad Protocol', 'unknown', 'draft'
        );
        RAISE EXCEPTION 'invalid provider protocol family was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.providers (
            id, provider_code, display_name, protocol_family, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000002',
            'lingzhen', 'Duplicate Provider', 'custom_proxy', 'draft'
        );
        RAISE EXCEPTION 'duplicate provider code was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.models (
            id, provider_id, model_code, display_name, capability_type,
            parameter_schema, default_parameters, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000003',
            '61000000-0000-4000-8000-000000000001',
            'bad-schema', 'Bad Schema', 'video',
            '[]'::jsonb, '{}'::jsonb, 'draft'
        );
        RAISE EXCEPTION 'non-object parameter_schema was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.models (
            id, provider_id, model_code, display_name, capability_type,
            parameter_schema, default_parameters, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000004',
            '61000000-0000-4000-8000-000000000001',
            'bad-defaults', 'Bad Defaults', 'video',
            '{}'::jsonb, '[10]'::jsonb, 'draft'
        );
        RAISE EXCEPTION 'non-object default_parameters was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.models (
            id, provider_id, model_code, display_name, capability_type,
            parameter_schema, default_parameters, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000005',
            '61000000-0000-4000-8000-000000000001',
            'bad-capability', 'Bad Capability', 'three_d',
            '{}'::jsonb, '{}'::jsonb, 'draft'
        );
        RAISE EXCEPTION 'invalid model capability type was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.models (
            id, provider_id, model_code, display_name, capability_type,
            parameter_schema, default_parameters, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000006',
            '61000000-0000-4000-8000-000000000001',
            'bad-status', 'Bad Status', 'video',
            '{}'::jsonb, '{}'::jsonb, 'deleted'
        );
        RAISE EXCEPTION 'invalid model status was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.models (
            id, provider_id, model_code, display_name, capability_type,
            parameter_schema, default_parameters, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000007',
            '61000000-0000-4000-8000-000000000001',
            'seedance-2.0-fast', 'Duplicate Model Code', 'video',
            '{}'::jsonb, '{}'::jsonb, 'draft'
        );
        RAISE EXCEPTION 'duplicate provider model code was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.models (
            id, provider_id, model_code, display_name, capability_type,
            parameter_schema, default_parameters, status
        ) VALUES (
            'b1000000-0000-4000-8000-000000000008',
            '61000000-0000-4000-8000-000000000002',
            'active-on-inactive-provider', 'Invalid Active Model', 'text',
            '{}'::jsonb, '{}'::jsonb, 'active'
        );
        RAISE EXCEPTION 'active model was accepted for an inactive provider';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        UPDATE model_catalog.providers
        SET status = 'inactive'
        WHERE id = '61000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'provider with active models was deactivated';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.tenant_models (
            id, tenant_id, model_id, policy, updated_by_membership_id
        ) VALUES (
            'b1000000-0000-4000-8000-000000000009',
            '31000000-0000-4000-8000-000000000002',
            '71000000-0000-4000-8000-000000000001',
            'enabled',
            '51000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'tenant model accepted a cross-tenant operator';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.tenant_models (
            id, tenant_id, model_id, policy, updated_by_membership_id
        ) VALUES (
            'b1000000-0000-4000-8000-000000000010',
            '31000000-0000-4000-8000-000000000002',
            '71000000-0000-4000-8000-000000000001',
            'disabled',
            '51000000-0000-4000-8000-000000000002'
        );
        RAISE EXCEPTION 'invalid tenant model policy was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.catalog_versions (
            id, version_no, content_hash, idempotency_key,
            published_by_user_id, published_by_membership_id, published_at, is_current
        ) VALUES (
            'b1000000-0000-4000-8000-000000000011',
            2, repeat('b', 64), 'catalog-publish-2',
            '41000000-0000-4000-8000-000000000001',
            '51000000-0000-4000-8000-000000000001',
            now(), true
        );
        RAISE EXCEPTION 'a second current catalog version was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.catalog_versions (
            id, version_no, content_hash, idempotency_key,
            published_by_user_id, published_by_membership_id
        ) VALUES (
            'b1000000-0000-4000-8000-000000000012',
            2, repeat('b', 64), 'catalog-publish-1',
            '41000000-0000-4000-8000-000000000001',
            '51000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'duplicate catalog idempotency key was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.catalog_versions (
            id, version_no, content_hash, idempotency_key,
            published_by_user_id, published_by_membership_id
        ) VALUES (
            'b1000000-0000-4000-8000-000000000013',
            3, repeat('c', 64), 'catalog-publish-3',
            '41000000-0000-4000-8000-000000000002',
            '51000000-0000-4000-8000-000000000001'
        );
        RAISE EXCEPTION 'catalog version accepted a Membership owned by another user';
    EXCEPTION WHEN foreign_key_violation THEN
        NULL;
    END;

    BEGIN
        UPDATE model_catalog.catalog_version_items
        SET display_name = 'Mutated Snapshot'
        WHERE id = '91000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'published snapshot item was updated';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        NULL;
    END;

    BEGIN
        DELETE FROM model_catalog.catalog_version_items
        WHERE id = '91000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'published snapshot item was deleted';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        NULL;
    END;

    BEGIN
        INSERT INTO model_catalog.catalog_version_items (
            id, catalog_version_id, model_id, provider_id,
            provider_code, provider_display_name, provider_protocol_family,
            model_code, display_name, capability_type,
            parameter_schema, default_parameters, default_tenant_enabled, sort_order
        ) VALUES (
            'b1000000-0000-4000-8000-000000000014',
            '81000000-0000-4000-8000-000000000001',
            '71000000-0000-4000-8000-000000000002',
            '61000000-0000-4000-8000-000000000001',
            'lingzhen', 'LingZhen Platform', 'custom_proxy',
            'draft-image-model', 'Draft Image Model', 'image',
            '{}'::jsonb, '{}'::jsonb, false, 20
        );
        RAISE EXCEPTION 'an item was appended to a published snapshot';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        NULL;
    END;

    BEGIN
        UPDATE model_catalog.catalog_versions
        SET content_hash = repeat('d', 64)
        WHERE id = '81000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'published catalog version metadata was updated';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        NULL;
    END;

    BEGIN
        DELETE FROM model_catalog.catalog_versions
        WHERE id = '81000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'published catalog version was deleted';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        NULL;
    END;

    BEGIN
        DELETE FROM model_catalog.models
        WHERE id = '71000000-0000-4000-8000-000000000001';
        RAISE EXCEPTION 'published model was hard deleted';
    EXCEPTION WHEN SQLSTATE '55000' THEN
        NULL;
    END;
END
$$;

DO $$
BEGIN
    BEGIN
        SET CONSTRAINTS ALL DEFERRED;

        INSERT INTO model_catalog.catalog_versions (
            id, version_no, content_hash, idempotency_key,
            published_by_user_id, published_by_membership_id
        ) VALUES (
            'c1000000-0000-4000-8000-000000000001',
            4, repeat('e', 64), 'catalog-publish-4',
            '41000000-0000-4000-8000-000000000001',
            '51000000-0000-4000-8000-000000000001'
        );

        SET CONSTRAINTS ALL IMMEDIATE;
        RAISE EXCEPTION 'an unsealed catalog version survived deferred validation';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    SET CONSTRAINTS ALL DEFERRED;
END
$$;

ROLLBACK;
