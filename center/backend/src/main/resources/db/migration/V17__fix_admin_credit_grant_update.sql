SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'admin credit grant fix migration must run as lingframe_owner';
    END IF;
END
$$;

CREATE OR REPLACE FUNCTION billing.grant_admin_credits(
    p_user_id uuid,
    p_operator_user_id uuid,
    p_credits bigint,
    p_reason varchar,
    p_idempotency_key varchar,
    p_grant_id uuid
)
RETURNS TABLE (
    available_balance bigint,
    reserved_balance bigint,
    idempotent_replay boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    wallet billing.user_wallets%ROWTYPE;
    existing billing.credit_ledger_entries%ROWTYPE;
BEGIN
    IF p_credits <= 0 OR p_credits > 9007199254740991 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_VALUE_INVALID';
    END IF;
    IF p_operator_user_id IS NULL OR p_reason IS NULL OR btrim(p_reason) = '' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'ADMIN_GRANT_METADATA_INVALID';
    END IF;

    SELECT * INTO existing
    FROM billing.credit_ledger_entries
    WHERE business_type = 'admin_credit_grant'
      AND idempotency_key = p_idempotency_key;
    IF FOUND THEN
        SELECT * INTO wallet FROM billing.user_wallets WHERE user_id = existing.user_id;
        RETURN QUERY SELECT wallet.available_balance, wallet.reserved_balance, true;
        RETURN;
    END IF;

    SELECT * INTO wallet
    FROM billing.user_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_WALLET_UNAVAILABLE';
    END IF;
    IF wallet.available_balance > 9007199254740991 - p_credits THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_VALUE_INVALID';
    END IF;

    UPDATE billing.user_wallets AS target
    SET available_balance = target.available_balance + p_credits,
        updated_at = now(),
        row_version = target.row_version + 1
    WHERE target.user_id = p_user_id
    RETURNING target.* INTO wallet;

    INSERT INTO billing.credit_ledger_entries (
        id, user_id, entry_type, available_delta, reserved_delta,
        available_after, reserved_after, business_type, business_id,
        idempotency_key, operator_user_id, reason
    ) VALUES (
        p_grant_id, p_user_id, 'manual_adjustment', p_credits, 0,
        wallet.available_balance, wallet.reserved_balance, 'admin_credit_grant',
        p_user_id::text, p_idempotency_key, p_operator_user_id, btrim(p_reason)
    );
    RETURN QUERY SELECT wallet.available_balance, wallet.reserved_balance, false;
END;
$$;

REVOKE ALL ON FUNCTION billing.grant_admin_credits(uuid, uuid, bigint, varchar, varchar, uuid)
    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing.grant_admin_credits(uuid, uuid, bigint, varchar, varchar, uuid)
    TO lingframe_app;
