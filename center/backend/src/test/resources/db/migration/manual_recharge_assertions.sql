DO $$
BEGIN
    IF to_regprocedure('billing.create_manual_recharge_order(uuid,character varying,uuid,uuid,character varying,timestamp with time zone,character varying)') IS NULL
       OR to_regprocedure('billing.approve_manual_recharge_order(uuid,uuid,character varying,timestamp with time zone,uuid)') IS NULL
       OR to_regprocedure('billing.reject_manual_recharge_order(uuid,uuid,character varying,timestamp with time zone)') IS NULL
       OR to_regprocedure('billing.cancel_manual_recharge_order(uuid,uuid,timestamp with time zone)') IS NULL THEN
        RAISE EXCEPTION 'manual recharge functions missing';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'billing' AND table_name = 'recharge_orders'
          AND column_name = 'submission_note'
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_indexes
        WHERE schemaname = 'billing' AND indexname = 'recharge_orders_manual_review_idx'
    ) THEN
        RAISE EXCEPTION 'manual recharge order review structure missing';
    END IF;
    IF has_table_privilege('lingframe_app', 'billing.user_wallets', 'UPDATE')
       OR has_table_privilege('lingframe_app', 'billing.credit_ledger_entries', 'INSERT') THEN
        RAISE EXCEPTION 'application role received direct billing write permission';
    END IF;
    IF NOT has_function_privilege(
        'lingframe_app',
        'billing.approve_manual_recharge_order(uuid,uuid,character varying,timestamp with time zone,uuid)',
        'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'application role cannot execute manual approval function';
    END IF;
END
$$;
