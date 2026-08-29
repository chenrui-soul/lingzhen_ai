SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'recharge payment migrations must run as lingframe_owner';
    END IF;
    IF to_regnamespace('billing') IS NULL
       OR to_regclass('billing.recharge_packages') IS NULL
       OR to_regclass('billing.recharge_orders') IS NULL
       OR to_regclass('billing.user_wallets') IS NULL
       OR to_regclass('billing.credit_ledger_entries') IS NULL THEN
        RAISE EXCEPTION 'recharge payment migration requires billing V7 state';
    END IF;
END
$$;

CREATE FUNCTION billing.create_recharge_package(
    p_id uuid,
    p_package_code varchar,
    p_display_name varchar,
    p_cash_amount_cents bigint,
    p_credit_amount bigint,
    p_bonus_credits bigint,
    p_sort_order integer,
    p_created_by_user_id uuid
)
RETURNS SETOF billing.recharge_packages
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
    INSERT INTO billing.recharge_packages (
        id, package_code, display_name, cash_amount_cents,
        credit_amount, bonus_credits, status, sort_order, created_by_user_id
    ) VALUES (
        p_id, p_package_code, p_display_name, p_cash_amount_cents,
        p_credit_amount, p_bonus_credits, 'draft', p_sort_order, p_created_by_user_id
    )
    RETURNING *;
$$;

CREATE FUNCTION billing.update_recharge_package(
    p_id uuid,
    p_display_name varchar,
    p_cash_amount_cents bigint,
    p_credit_amount bigint,
    p_bonus_credits bigint,
    p_status varchar,
    p_sort_order integer,
    p_row_version bigint
)
RETURNS SETOF billing.recharge_packages
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
    UPDATE billing.recharge_packages
    SET display_name = p_display_name,
        cash_amount_cents = p_cash_amount_cents,
        credit_amount = p_credit_amount,
        bonus_credits = p_bonus_credits,
        status = p_status,
        sort_order = p_sort_order,
        updated_at = now(),
        row_version = row_version + 1
    WHERE id = p_id
      AND row_version = p_row_version
    RETURNING *;
$$;

CREATE FUNCTION billing.create_recharge_order(
    p_id uuid,
    p_order_no varchar,
    p_user_id uuid,
    p_package_id uuid,
    p_payment_channel varchar,
    p_idempotency_key varchar,
    p_expires_at timestamptz
)
RETURNS SETOF billing.recharge_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    selected_package billing.recharge_packages%ROWTYPE;
    existing_order billing.recharge_orders%ROWTYPE;
BEGIN
    SELECT *
    INTO existing_order
    FROM billing.recharge_orders
    WHERE user_id = p_user_id
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
        RETURN NEXT existing_order;
        RETURN;
    END IF;

    SELECT *
    INTO selected_package
    FROM billing.recharge_packages
    WHERE id = p_package_id
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION USING
            ERRCODE = 'P0001',
            MESSAGE = 'RECHARGE_PACKAGE_NOT_ACTIVE';
    END IF;

    RETURN QUERY
    INSERT INTO billing.recharge_orders (
        id, order_no, user_id, package_id, package_code_snapshot,
        cash_amount_cents, credit_amount, bonus_credits, payment_channel,
        status, idempotency_key, expires_at
    ) VALUES (
        p_id, p_order_no, p_user_id, selected_package.id, selected_package.package_code,
        selected_package.cash_amount_cents, selected_package.credit_amount,
        selected_package.bonus_credits, p_payment_channel,
        'pending', p_idempotency_key, p_expires_at
    )
    ON CONFLICT (user_id, idempotency_key) DO NOTHING
    RETURNING *;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT *
        FROM billing.recharge_orders
        WHERE user_id = p_user_id
          AND idempotency_key = p_idempotency_key;
    END IF;
END;
$$;

CREATE FUNCTION billing.close_recharge_order(
    p_order_id uuid,
    p_user_id uuid,
    p_closed_at timestamptz,
    p_require_expired boolean
)
RETURNS SETOF billing.recharge_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
BEGIN
    RETURN QUERY
    UPDATE billing.recharge_orders
    SET status = 'closed',
        closed_at = p_closed_at,
        updated_at = p_closed_at,
        row_version = row_version + 1
    WHERE id = p_order_id
      AND user_id = p_user_id
      AND status = 'pending'
      AND (NOT p_require_expired OR expires_at <= p_closed_at)
    RETURNING *;

    IF NOT FOUND THEN
        RETURN QUERY
        SELECT *
        FROM billing.recharge_orders
        WHERE id = p_order_id
          AND user_id = p_user_id;
    END IF;
END;
$$;

CREATE FUNCTION billing.apply_sandbox_payment(
    p_order_id uuid,
    p_channel_trade_no varchar,
    p_event_id varchar,
    p_cash_amount_cents bigint,
    p_paid_at timestamptz,
    p_ledger_id uuid
)
RETURNS TABLE (
    order_status varchar,
    idempotent_replay boolean,
    available_balance bigint,
    reserved_balance bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    selected_order billing.recharge_orders%ROWTYPE;
    selected_wallet billing.user_wallets%ROWTYPE;
    credit_total bigint;
BEGIN
    SELECT *
    INTO selected_order
    FROM billing.recharge_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_NOT_FOUND';
    END IF;
    IF selected_order.payment_channel <> 'sandbox' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_CHANNEL_MISMATCH';
    END IF;
    IF selected_order.cash_amount_cents <> p_cash_amount_cents THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_AMOUNT_MISMATCH';
    END IF;
    IF selected_order.status = 'paid' THEN
        IF selected_order.channel_trade_no = p_channel_trade_no THEN
            SELECT * INTO selected_wallet
            FROM billing.user_wallets
            WHERE user_id = selected_order.user_id;
            RETURN QUERY SELECT 'paid'::varchar, true,
                selected_wallet.available_balance, selected_wallet.reserved_balance;
            RETURN;
        END IF;
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_STATE_CONFLICT';
    END IF;
    IF selected_order.status <> 'pending' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_STATE_CONFLICT';
    END IF;
    IF selected_order.expires_at <= p_paid_at THEN
        UPDATE billing.recharge_orders
        SET status = 'closed', closed_at = p_paid_at, updated_at = p_paid_at,
            row_version = row_version + 1
        WHERE id = selected_order.id;
        SELECT * INTO selected_wallet
        FROM billing.user_wallets
        WHERE user_id = selected_order.user_id;
        RETURN QUERY SELECT 'closed'::varchar, false,
            selected_wallet.available_balance, selected_wallet.reserved_balance;
        RETURN;
    END IF;

    credit_total := selected_order.credit_amount + selected_order.bonus_credits;

    SELECT *
    INTO selected_wallet
    FROM billing.user_wallets
    WHERE user_id = selected_order.user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_WALLET_UNAVAILABLE';
    END IF;
    IF selected_wallet.available_balance > 9007199254740991 - credit_total THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'CREDIT_VALUE_INVALID';
    END IF;

    UPDATE billing.user_wallets AS wallet
    SET available_balance = wallet.available_balance + credit_total,
        updated_at = p_paid_at,
        row_version = wallet.row_version + 1
    WHERE wallet.user_id = selected_order.user_id
    RETURNING wallet.* INTO selected_wallet;

    INSERT INTO billing.credit_ledger_entries (
        id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
        available_after, reserved_after, business_type, business_id,
        idempotency_key, recharge_order_id, reason, created_at
    ) VALUES (
        p_ledger_id, selected_order.user_id, NULL, 'recharge', credit_total, 0,
        selected_wallet.available_balance, selected_wallet.reserved_balance,
        'recharge_order', selected_order.order_no,
        'sandbox:' || p_event_id, selected_order.id,
        'Sandbox payment confirmed', p_paid_at
    );

    UPDATE billing.recharge_orders
    SET status = 'paid',
        channel_trade_no = p_channel_trade_no,
        paid_at = p_paid_at,
        updated_at = p_paid_at,
        row_version = row_version + 1
    WHERE id = selected_order.id;

    RETURN QUERY SELECT 'paid'::varchar, false,
        selected_wallet.available_balance, selected_wallet.reserved_balance;
END;
$$;

REVOKE ALL ON FUNCTION billing.create_recharge_package(
    uuid, varchar, varchar, bigint, bigint, bigint, integer, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.update_recharge_package(
    uuid, varchar, bigint, bigint, bigint, varchar, integer, bigint
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.create_recharge_order(
    uuid, varchar, uuid, uuid, varchar, varchar, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.close_recharge_order(
    uuid, uuid, timestamptz, boolean
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.apply_sandbox_payment(
    uuid, varchar, varchar, bigint, timestamptz, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION billing.create_recharge_package(
    uuid, varchar, varchar, bigint, bigint, bigint, integer, uuid
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.update_recharge_package(
    uuid, varchar, bigint, bigint, bigint, varchar, integer, bigint
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.create_recharge_order(
    uuid, varchar, uuid, uuid, varchar, varchar, timestamptz
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.close_recharge_order(
    uuid, uuid, timestamptz, boolean
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.apply_sandbox_payment(
    uuid, varchar, varchar, bigint, timestamptz, uuid
) TO lingframe_app;

COMMENT ON FUNCTION billing.apply_sandbox_payment(
    uuid, varchar, varchar, bigint, timestamptz, uuid
) IS 'Atomically marks a sandbox order paid, credits the wallet and appends one immutable ledger entry.';
