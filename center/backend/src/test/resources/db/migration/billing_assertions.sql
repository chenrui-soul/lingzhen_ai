BEGIN;

DO $$
DECLARE
    expected_table text;
BEGIN
    FOREACH expected_table IN ARRAY ARRAY[
        'credit_ledger_entries',
        'credit_reservations',
        'credit_settlements',
        'model_price_versions',
        'recharge_orders',
        'recharge_packages',
        'user_wallets'
    ]
    LOOP
        IF to_regclass(format('billing.%I', expected_table)) IS NULL THEN
            RAISE EXCEPTION 'missing billing table: %', expected_table;
        END IF;
        IF (
            SELECT pg_get_userbyid(class_entry.relowner)
            FROM pg_class AS class_entry
            JOIN pg_namespace AS namespace_entry ON namespace_entry.oid = class_entry.relnamespace
            WHERE namespace_entry.nspname = 'billing'
              AND class_entry.relname = expected_table
        ) <> 'lingframe_owner' THEN
            RAISE EXCEPTION 'unexpected owner for billing.%', expected_table;
        END IF;
    END LOOP;

    IF NOT has_schema_privilege('lingframe_app', 'billing', 'USAGE') THEN
        RAISE EXCEPTION 'lingframe_app requires billing schema usage';
    END IF;

    IF has_function_privilege(
        'lingframe_app',
        'billing.create_user_wallet_after_insert()',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'lingframe_app must not execute the wallet provisioning function directly';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger
        WHERE tgname = 'billing_user_wallet_after_insert_trg'
          AND tgrelid = 'identity.users'::regclass
          AND NOT tgisinternal
    ) THEN
        RAISE EXCEPTION 'new identity users require automatic wallet provisioning';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'billing.user_wallets', 'SELECT')
       OR has_table_privilege('lingframe_app', 'billing.user_wallets', 'INSERT')
       OR has_table_privilege('lingframe_app', 'billing.user_wallets', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'billing.user_wallets', 'DELETE') THEN
        RAISE EXCEPTION 'unexpected application wallet privileges';
    END IF;

    IF NOT has_table_privilege('lingframe_app', 'billing.credit_ledger_entries', 'SELECT')
       OR has_table_privilege('lingframe_app', 'billing.credit_ledger_entries', 'INSERT')
       OR has_table_privilege('lingframe_app', 'billing.credit_ledger_entries', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'billing.credit_ledger_entries', 'DELETE') THEN
        RAISE EXCEPTION 'unexpected application ledger privileges';
    END IF;

    IF (
        SELECT available_balance
        FROM billing.user_wallets
        WHERE user_id = '42000000-0000-4000-8000-000000000001'
    ) <> 125 THEN
        RAISE EXCEPTION 'legacy duplicate balances were not collapsed safely';
    END IF;

    IF (
        SELECT count(*)
        FROM billing.credit_ledger_entries
        WHERE user_id = '42000000-0000-4000-8000-000000000001'
          AND entry_type = 'migration'
          AND available_delta = 125
          AND available_after = 125
    ) <> 1 THEN
        RAISE EXCEPTION 'legacy non-zero balance requires exactly one migration ledger entry';
    END IF;
END
$$;

INSERT INTO model_catalog.providers (
    id, provider_code, display_name, protocol_family, status
)
VALUES (
    '45000000-0000-4000-8000-000000000001',
    'billing_provider',
    'Billing Provider',
    'custom_proxy',
    'active'
);

INSERT INTO model_catalog.models (
    id, provider_id, model_code, display_name, capability_type,
    parameter_schema, default_parameters, default_tenant_enabled, status
)
VALUES (
    '46000000-0000-4000-8000-000000000001',
    '45000000-0000-4000-8000-000000000001',
    'billing-model',
    'Billing Model',
    'video',
    '{"type":"object"}'::jsonb,
    '{}'::jsonb,
    false,
    'active'
);

INSERT INTO billing.recharge_packages (
    id, package_code, display_name, cash_amount_cents,
    credit_amount, bonus_credits, status
)
VALUES (
    '47000000-0000-4000-8000-000000000001',
    'starter_100',
    'Starter 100',
    1000,
    100,
    10,
    'active'
);

INSERT INTO billing.recharge_orders (
    id, order_no, user_id, package_id, package_code_snapshot,
    cash_amount_cents, credit_amount, bonus_credits, payment_channel,
    status, idempotency_key, expires_at
)
VALUES (
    '48000000-0000-4000-8000-000000000001',
    'LZ202608250001',
    '42000000-0000-4000-8000-000000000001',
    '47000000-0000-4000-8000-000000000001',
    'starter_100',
    1000,
    100,
    10,
    'sandbox',
    'pending',
    'order-fixture-1',
    now() + interval '30 minutes'
);

INSERT INTO billing.model_price_versions (
    id, model_id, version_no, pricing_unit, base_credits,
    max_reserve_credits, price_rule, content_hash, status, activated_at
)
VALUES (
    '49000000-0000-4000-8000-000000000001',
    '46000000-0000-4000-8000-000000000001',
    1,
    'request',
    20,
    30,
    '{"duration10Seconds":30}'::jsonb,
    repeat('a', 64),
    'active',
    now()
);

DO $$
BEGIN
    BEGIN
        INSERT INTO billing.model_price_versions (
            id, model_id, version_no, pricing_unit, base_credits,
            max_reserve_credits, price_rule, content_hash, status, activated_at
        )
        VALUES (
            '49000000-0000-4000-8000-000000000002',
            '46000000-0000-4000-8000-000000000001',
            2, 'request', 25, 35, '{}'::jsonb, repeat('b', 64), 'active', now()
        );
        RAISE EXCEPTION 'duplicate active price version unexpectedly succeeded';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END
$$;

INSERT INTO billing.credit_reservations (
    id, user_id, tenant_id, task_id, attempt_id, client_request_id,
    price_version_id, reserved_credits, status, idempotency_key
)
VALUES (
    '4a000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    'task-billing-1',
    'attempt-1',
    'client-request-1',
    '49000000-0000-4000-8000-000000000001',
    30,
    'reserved',
    'reserve-fixture-1'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO billing.credit_reservations (
            id, user_id, tenant_id, task_id, attempt_id, client_request_id,
            price_version_id, reserved_credits, status, idempotency_key
        )
        VALUES (
            '4a000000-0000-4000-8000-000000000002',
            '42000000-0000-4000-8000-000000000001',
            '41000000-0000-4000-8000-000000000001',
            'task-billing-2', 'attempt-1', 'client-request-1',
            '49000000-0000-4000-8000-000000000001',
            30, 'reserved', 'reserve-fixture-2'
        );
        RAISE EXCEPTION 'duplicate client request unexpectedly created a second reservation';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END
$$;

INSERT INTO billing.credit_settlements (
    id, reservation_id, user_id, tenant_id, task_id, attempt_id,
    charged_credits, result_reference, idempotency_key
)
VALUES (
    '4b000000-0000-4000-8000-000000000001',
    '4a000000-0000-4000-8000-000000000001',
    '42000000-0000-4000-8000-000000000001',
    '41000000-0000-4000-8000-000000000001',
    'task-billing-1',
    'attempt-1',
    20,
    'result:billing-fixture',
    'settlement-fixture-1'
);

DO $$
BEGIN
    BEGIN
        INSERT INTO billing.credit_settlements (
            id, reservation_id, user_id, tenant_id, task_id, attempt_id,
            charged_credits, result_reference, idempotency_key
        )
        VALUES (
            '4b000000-0000-4000-8000-000000000002',
            '4a000000-0000-4000-8000-000000000001',
            '42000000-0000-4000-8000-000000000001',
            '41000000-0000-4000-8000-000000000001',
            'task-billing-1', 'attempt-2', 20, 'result:duplicate', 'settlement-fixture-2'
        );
        RAISE EXCEPTION 'duplicate task settlement unexpectedly succeeded';
    EXCEPTION
        WHEN unique_violation THEN NULL;
    END;
END
$$;

DO $$
DECLARE
    migration_entry_id uuid;
BEGIN
    SELECT id INTO migration_entry_id
    FROM billing.credit_ledger_entries
    WHERE user_id = '42000000-0000-4000-8000-000000000001'
      AND entry_type = 'migration';

    BEGIN
        UPDATE billing.credit_ledger_entries
        SET reason = 'mutated'
        WHERE id = migration_entry_id;
        RAISE EXCEPTION 'immutable ledger update unexpectedly succeeded';
    EXCEPTION
        WHEN raise_exception THEN
            IF SQLERRM <> 'billing immutable records cannot be updated or deleted' THEN
                RAISE;
            END IF;
    END;

    BEGIN
        DELETE FROM billing.credit_ledger_entries WHERE id = migration_entry_id;
        RAISE EXCEPTION 'immutable ledger delete unexpectedly succeeded';
    EXCEPTION
        WHEN raise_exception THEN
            IF SQLERRM <> 'billing immutable records cannot be updated or deleted' THEN
                RAISE;
            END IF;
    END;
END
$$;

ROLLBACK;
