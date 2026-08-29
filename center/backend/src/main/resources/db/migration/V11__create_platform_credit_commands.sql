SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'platform credit migrations must run as lingframe_owner';
    END IF;
    IF to_regclass('billing.user_wallets') IS NULL
       OR to_regclass('billing.credit_reservations') IS NULL
       OR to_regclass('billing.credit_settlements') IS NULL
       OR to_regclass('billing.credit_ledger_entries') IS NULL THEN
        RAISE EXCEPTION 'platform credit migration requires billing v7 state';
    END IF;
END
$$;

CREATE FUNCTION billing.reserve_platform_credits(
    p_reservation_id uuid,
    p_user_id uuid,
    p_tenant_id uuid,
    p_task_id varchar,
    p_attempt_id varchar,
    p_client_request_id varchar,
    p_price_version_id uuid,
    p_reserved_credits bigint,
    p_idempotency_key varchar,
    p_expires_at timestamptz,
    p_ledger_id uuid
)
RETURNS TABLE (
    reservation_id uuid,
    reservation_status varchar,
    idempotent_replay boolean,
    available_balance bigint,
    reserved_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    existing billing.credit_reservations%ROWTYPE;
    wallet billing.user_wallets%ROWTYPE;
BEGIN
    IF p_reserved_credits <= 0 THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_RESERVE_INVALID_AMOUNT';
    END IF;

    SELECT * INTO existing
    FROM billing.credit_reservations
    WHERE user_id = p_user_id AND idempotency_key = p_idempotency_key
    FOR UPDATE;
    IF FOUND THEN
        RETURN QUERY SELECT existing.id, existing.status, true,
            (SELECT w.available_balance FROM billing.user_wallets AS w WHERE w.user_id = p_user_id),
            (SELECT w.reserved_balance FROM billing.user_wallets AS w WHERE w.user_id = p_user_id);
        RETURN;
    END IF;

    SELECT * INTO existing
    FROM billing.credit_reservations
    WHERE task_id = p_task_id AND attempt_id = p_attempt_id
    FOR UPDATE;
    IF FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_RESERVATION_STATE_CONFLICT';
    END IF;

    SELECT * INTO wallet
    FROM billing.user_wallets
    WHERE user_id = p_user_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_WALLET_UNAVAILABLE';
    END IF;
    IF wallet.available_balance < p_reserved_credits THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_INSUFFICIENT';
    END IF;

    UPDATE billing.user_wallets AS target
    SET available_balance = target.available_balance - p_reserved_credits,
        reserved_balance = target.reserved_balance + p_reserved_credits,
        updated_at = now(),
        row_version = row_version + 1
    WHERE target.user_id = p_user_id
    RETURNING target.* INTO wallet;

    INSERT INTO billing.credit_reservations (
        id, user_id, tenant_id, task_id, attempt_id, client_request_id,
        price_version_id, reserved_credits, idempotency_key, expires_at
    ) VALUES (
        p_reservation_id, p_user_id, p_tenant_id, p_task_id, p_attempt_id, p_client_request_id,
        p_price_version_id, p_reserved_credits, p_idempotency_key, p_expires_at
    );

    INSERT INTO billing.credit_ledger_entries (
        id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
        available_after, reserved_after, business_type, business_id,
        idempotency_key, reservation_id, reason
    ) VALUES (
        p_ledger_id, p_user_id, p_tenant_id, 'reserve', -p_reserved_credits, p_reserved_credits,
        wallet.available_balance, wallet.reserved_balance, 'platform_model_task', p_task_id,
        p_idempotency_key, p_reservation_id, 'Platform model task credit reservation'
    );

    RETURN QUERY SELECT p_reservation_id, 'reserved'::varchar, false,
        wallet.available_balance, wallet.reserved_balance;
END;
$$;

CREATE FUNCTION billing.settle_platform_credits(
    p_reservation_id uuid,
    p_task_id varchar,
    p_attempt_id varchar,
    p_charged_credits bigint,
    p_result_reference varchar,
    p_idempotency_key varchar,
    p_settlement_id uuid,
    p_ledger_id uuid
)
RETURNS TABLE (
    reservation_id uuid,
    reservation_status varchar,
    idempotent_replay boolean,
    available_balance bigint,
    reserved_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    reservation billing.credit_reservations%ROWTYPE;
    wallet billing.user_wallets%ROWTYPE;
    refund bigint;
BEGIN
    SELECT * INTO reservation
    FROM billing.credit_reservations
    WHERE id = p_reservation_id
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_RESERVATION_NOT_FOUND';
    END IF;
    IF EXISTS (SELECT 1 FROM billing.credit_settlements AS settlement
               WHERE settlement.reservation_id = p_reservation_id
                  OR settlement.idempotency_key = p_idempotency_key) THEN
        SELECT * INTO wallet FROM billing.user_wallets WHERE user_id = reservation.user_id;
        RETURN QUERY SELECT reservation.id, reservation.status, true,
            wallet.available_balance, wallet.reserved_balance;
        RETURN;
    END IF;
    IF reservation.status <> 'reserved' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_RESERVATION_STATE_CONFLICT';
    END IF;
    IF p_charged_credits <= 0 OR p_charged_credits > reservation.reserved_credits THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_SETTLEMENT_INVALID_AMOUNT';
    END IF;

    SELECT * INTO wallet FROM billing.user_wallets WHERE user_id = reservation.user_id FOR UPDATE;
    refund := reservation.reserved_credits - p_charged_credits;
    UPDATE billing.user_wallets AS target
    SET available_balance = target.available_balance + refund,
        reserved_balance = target.reserved_balance - reservation.reserved_credits,
        updated_at = now(), row_version = row_version + 1
    WHERE target.user_id = reservation.user_id
    RETURNING target.* INTO wallet;

    INSERT INTO billing.credit_settlements (
        id, reservation_id, user_id, tenant_id, task_id, attempt_id,
        charged_credits, result_reference, idempotency_key
    ) VALUES (
        p_settlement_id, reservation.id, reservation.user_id, reservation.tenant_id,
        p_task_id, p_attempt_id, p_charged_credits, NULLIF(btrim(p_result_reference), ''), p_idempotency_key
    );
    INSERT INTO billing.credit_ledger_entries (
        id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
        available_after, reserved_after, business_type, business_id,
        idempotency_key, reservation_id, settlement_id, reason
    ) VALUES (
        p_ledger_id, reservation.user_id, reservation.tenant_id, 'settle', refund,
        -reservation.reserved_credits, wallet.available_balance, wallet.reserved_balance,
        'platform_model_task', p_task_id, p_idempotency_key, reservation.id, p_settlement_id,
        'Platform model task credit settlement'
    );
    UPDATE billing.credit_reservations
    SET settled_credits = p_charged_credits, status = 'settled', settled_at = now(),
        updated_at = now(), row_version = row_version + 1
    WHERE id = reservation.id;

    RETURN QUERY SELECT reservation.id, 'settled'::varchar, false,
        wallet.available_balance, wallet.reserved_balance;
END;
$$;

CREATE FUNCTION billing.release_platform_credits(
    p_reservation_id uuid,
    p_task_id varchar,
    p_attempt_id varchar,
    p_idempotency_key varchar,
    p_ledger_id uuid
)
RETURNS TABLE (
    reservation_id uuid,
    reservation_status varchar,
    idempotent_replay boolean,
    available_balance bigint,
    reserved_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    reservation billing.credit_reservations%ROWTYPE;
    wallet billing.user_wallets%ROWTYPE;
BEGIN
    SELECT * INTO reservation FROM billing.credit_reservations WHERE id = p_reservation_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_RESERVATION_NOT_FOUND';
    END IF;
    IF reservation.status <> 'reserved' THEN
        SELECT * INTO wallet FROM billing.user_wallets WHERE user_id = reservation.user_id;
        RETURN QUERY SELECT reservation.id, reservation.status, true,
            wallet.available_balance, wallet.reserved_balance;
        RETURN;
    END IF;
    SELECT * INTO wallet FROM billing.user_wallets WHERE user_id = reservation.user_id FOR UPDATE;
    UPDATE billing.user_wallets AS target
    SET available_balance = target.available_balance + reservation.reserved_credits,
        reserved_balance = target.reserved_balance - reservation.reserved_credits,
        updated_at = now(), row_version = row_version + 1
    WHERE target.user_id = reservation.user_id
    RETURNING target.* INTO wallet;

    INSERT INTO billing.credit_ledger_entries (
        id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
        available_after, reserved_after, business_type, business_id,
        idempotency_key, reservation_id, reason
    ) VALUES (
        p_ledger_id, reservation.user_id, reservation.tenant_id, 'release', reservation.reserved_credits,
        -reservation.reserved_credits, wallet.available_balance, wallet.reserved_balance,
        'platform_model_task', p_task_id, p_idempotency_key, reservation.id,
        'Platform model task credit release'
    );
    UPDATE billing.credit_reservations
    SET released_credits = reserved_credits, status = 'released', released_at = now(),
        updated_at = now(), row_version = row_version + 1
    WHERE id = reservation.id;

    RETURN QUERY SELECT reservation.id, 'released'::varchar, false,
        wallet.available_balance, wallet.reserved_balance;
END;
$$;

REVOKE ALL ON FUNCTION billing.reserve_platform_credits(
    uuid, uuid, uuid, varchar, varchar, varchar, uuid, bigint, varchar, timestamptz, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.settle_platform_credits(
    uuid, varchar, varchar, bigint, varchar, varchar, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.release_platform_credits(
    uuid, varchar, varchar, varchar, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing.reserve_platform_credits(
    uuid, uuid, uuid, varchar, varchar, varchar, uuid, bigint, varchar, timestamptz, uuid
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.settle_platform_credits(
    uuid, varchar, varchar, bigint, varchar, varchar, uuid, uuid
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.release_platform_credits(
    uuid, varchar, varchar, varchar, uuid
) TO lingframe_app;

COMMENT ON FUNCTION billing.reserve_platform_credits IS 'Atomically reserve user credits for a platform model task.';
COMMENT ON FUNCTION billing.settle_platform_credits IS 'Atomically settle a successful platform model task and return any unused reservation.';
COMMENT ON FUNCTION billing.release_platform_credits IS 'Atomically release a reservation after an explicit platform task failure or cancellation.';
