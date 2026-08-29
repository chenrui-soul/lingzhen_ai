BEGIN;

DO $$
DECLARE
    function_signature text;
BEGIN
    FOREACH function_signature IN ARRAY ARRAY[
        'billing.create_recharge_package(uuid,character varying,character varying,bigint,bigint,bigint,integer,uuid)',
        'billing.update_recharge_package(uuid,character varying,bigint,bigint,bigint,character varying,integer,bigint)',
        'billing.create_recharge_order(uuid,character varying,uuid,uuid,character varying,character varying,timestamp with time zone)',
        'billing.close_recharge_order(uuid,uuid,timestamp with time zone,boolean)',
        'billing.apply_sandbox_payment(uuid,character varying,character varying,bigint,timestamp with time zone,uuid)'
    ]
    LOOP
        IF to_regprocedure(function_signature) IS NULL THEN
            RAISE EXCEPTION 'missing recharge command function: %', function_signature;
        END IF;
        IF NOT has_function_privilege('lingframe_app', function_signature, 'EXECUTE') THEN
            RAISE EXCEPTION 'lingframe_app requires execute on %', function_signature;
        END IF;
    END LOOP;

    IF has_table_privilege('lingframe_app', 'billing.recharge_packages', 'INSERT')
       OR has_table_privilege('lingframe_app', 'billing.recharge_packages', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'billing.recharge_orders', 'INSERT')
       OR has_table_privilege('lingframe_app', 'billing.recharge_orders', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'billing.user_wallets', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'billing.credit_ledger_entries', 'INSERT') THEN
        RAISE EXCEPTION 'application role received forbidden direct billing writes';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'billing'
          AND p.proname IN (
              'create_recharge_package', 'update_recharge_package',
              'create_recharge_order', 'close_recharge_order', 'apply_sandbox_payment'
          )
          AND NOT p.prosecdef
    ) THEN
        RAISE EXCEPTION 'recharge command functions must be security definer functions';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'billing'
          AND p.proname IN (
              'create_recharge_package', 'update_recharge_package',
              'create_recharge_order', 'close_recharge_order', 'apply_sandbox_payment'
          )
          AND coalesce(array_to_string(p.proconfig, ','), '') NOT LIKE '%search_path=pg_catalog, billing%'
    ) THEN
        RAISE EXCEPTION 'recharge command functions require a fixed safe search path';
    END IF;
END
$$;

ROLLBACK;
