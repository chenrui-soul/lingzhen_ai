SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'billing rollback must run as lingframe_owner';
    END IF;
    IF NOT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'billing'
          AND pg_get_userbyid(nspowner) = 'lingframe_owner'
    ) THEN
        RAISE EXCEPTION 'billing schema is missing or has an unexpected owner';
    END IF;
END
$$;

DROP TRIGGER credit_ledger_entries_immutable_trg ON billing.credit_ledger_entries;
DROP TRIGGER credit_settlements_immutable_trg ON billing.credit_settlements;
DROP TRIGGER billing_user_wallet_after_insert_trg ON identity.users;
DROP TABLE billing.credit_ledger_entries;
DROP TABLE billing.credit_settlements;
DROP TABLE billing.credit_reservations;
DROP TABLE billing.model_price_versions;
DROP TABLE billing.recharge_orders;
DROP TABLE billing.recharge_packages;
DROP TABLE billing.user_wallets;
DROP FUNCTION billing.prevent_immutable_record_mutation();
DROP FUNCTION billing.create_user_wallet_after_insert();
DROP SCHEMA billing;
