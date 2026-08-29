SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'manual recharge migrations must run as lingframe_owner';
    END IF;
    IF to_regclass('billing.recharge_orders') IS NULL
       OR to_regclass('billing.user_wallets') IS NULL
       OR to_regclass('billing.credit_ledger_entries') IS NULL
       OR to_regprocedure('billing.apply_sandbox_payment(uuid,character varying,character varying,bigint,timestamp with time zone,uuid)') IS NULL THEN
        RAISE EXCEPTION 'manual recharge migration requires billing V8 state';
    END IF;
END
$$;

ALTER TABLE billing.recharge_orders
    ADD COLUMN submission_note varchar(500),
    ADD COLUMN reviewed_by_user_id uuid REFERENCES identity.users (id),
    ADD COLUMN reviewed_at timestamptz,
    ADD COLUMN review_reason varchar(500);

ALTER TABLE billing.recharge_orders
    DROP CONSTRAINT recharge_orders_status_ck,
    ADD CONSTRAINT recharge_orders_status_ck CHECK (
        status IN ('pending', 'paid', 'closed', 'rejected', 'refund_pending', 'refunded', 'manual_review')
    ),
    ADD CONSTRAINT recharge_orders_review_ck CHECK (
        (reviewed_at IS NULL AND reviewed_by_user_id IS NULL)
        OR (reviewed_at IS NOT NULL AND reviewed_by_user_id IS NOT NULL)
    ),
    ADD CONSTRAINT recharge_orders_review_reason_ck CHECK (
        review_reason IS NULL OR btrim(review_reason) <> ''
    ),
    ADD CONSTRAINT recharge_orders_submission_note_ck CHECK (
        submission_note IS NULL OR btrim(submission_note) <> ''
    );

CREATE INDEX recharge_orders_manual_review_idx
    ON billing.recharge_orders (created_at, id)
    WHERE payment_channel = 'manual_transfer' AND status = 'manual_review';

CREATE FUNCTION billing.create_manual_recharge_order(
    p_id uuid,
    p_order_no varchar,
    p_user_id uuid,
    p_package_id uuid,
    p_idempotency_key varchar,
    p_expires_at timestamptz,
    p_submission_note varchar
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
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_PACKAGE_NOT_ACTIVE';
    END IF;

    RETURN QUERY
    INSERT INTO billing.recharge_orders (
        id, order_no, user_id, package_id, package_code_snapshot,
        cash_amount_cents, credit_amount, bonus_credits, payment_channel,
        status, idempotency_key, expires_at, submission_note
    ) VALUES (
        p_id, p_order_no, p_user_id, selected_package.id, selected_package.package_code,
        selected_package.cash_amount_cents, selected_package.credit_amount,
        selected_package.bonus_credits, 'manual_transfer',
        'manual_review', p_idempotency_key, p_expires_at, nullif(btrim(p_submission_note), '')
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

CREATE FUNCTION billing.approve_manual_recharge_order(
    p_order_id uuid,
    p_operator_user_id uuid,
    p_review_reason varchar,
    p_reviewed_at timestamptz,
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
    IF selected_order.payment_channel <> 'manual_transfer' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_CHANNEL_MISMATCH';
    END IF;
    IF selected_order.status = 'paid' THEN
        SELECT * INTO selected_wallet
        FROM billing.user_wallets
        WHERE user_id = selected_order.user_id;
        RETURN QUERY SELECT 'paid'::varchar, true,
            selected_wallet.available_balance, selected_wallet.reserved_balance;
        RETURN;
    END IF;
    IF selected_order.status <> 'manual_review' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_STATE_CONFLICT';
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
        updated_at = p_reviewed_at,
        row_version = wallet.row_version + 1
    WHERE wallet.user_id = selected_order.user_id
    RETURNING wallet.* INTO selected_wallet;

    INSERT INTO billing.credit_ledger_entries (
        id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
        available_after, reserved_after, business_type, business_id,
        idempotency_key, recharge_order_id, operator_user_id, reason, created_at
    ) VALUES (
        p_ledger_id, selected_order.user_id, NULL, 'recharge', credit_total, 0,
        selected_wallet.available_balance, selected_wallet.reserved_balance,
        'recharge_order', selected_order.order_no,
        'manual-review:' || selected_order.id::text, selected_order.id,
        p_operator_user_id, btrim(p_review_reason), p_reviewed_at
    );

    UPDATE billing.recharge_orders
    SET status = 'paid',
        paid_at = p_reviewed_at,
        reviewed_by_user_id = p_operator_user_id,
        reviewed_at = p_reviewed_at,
        review_reason = btrim(p_review_reason),
        updated_at = p_reviewed_at,
        row_version = row_version + 1
    WHERE id = selected_order.id;

    RETURN QUERY SELECT 'paid'::varchar, false,
        selected_wallet.available_balance, selected_wallet.reserved_balance;
END;
$$;

CREATE FUNCTION billing.reject_manual_recharge_order(
    p_order_id uuid,
    p_operator_user_id uuid,
    p_review_reason varchar,
    p_reviewed_at timestamptz
)
RETURNS SETOF billing.recharge_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    selected_order billing.recharge_orders%ROWTYPE;
BEGIN
    SELECT *
    INTO selected_order
    FROM billing.recharge_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_NOT_FOUND';
    END IF;
    IF selected_order.payment_channel <> 'manual_transfer' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_CHANNEL_MISMATCH';
    END IF;
    IF selected_order.status = 'rejected' THEN
        RETURN NEXT selected_order;
        RETURN;
    END IF;
    IF selected_order.status <> 'manual_review' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_STATE_CONFLICT';
    END IF;

    RETURN QUERY
    UPDATE billing.recharge_orders
    SET status = 'rejected',
        closed_at = p_reviewed_at,
        reviewed_by_user_id = p_operator_user_id,
        reviewed_at = p_reviewed_at,
        review_reason = btrim(p_review_reason),
        updated_at = p_reviewed_at,
        row_version = row_version + 1
    WHERE id = selected_order.id
    RETURNING *;
END;
$$;

CREATE FUNCTION billing.cancel_manual_recharge_order(
    p_order_id uuid,
    p_user_id uuid,
    p_closed_at timestamptz
)
RETURNS SETOF billing.recharge_orders
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing
AS $$
DECLARE
    selected_order billing.recharge_orders%ROWTYPE;
BEGIN
    SELECT *
    INTO selected_order
    FROM billing.recharge_orders
    WHERE id = p_order_id
      AND user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_NOT_FOUND';
    END IF;
    IF selected_order.payment_channel <> 'manual_transfer' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'PAYMENT_CHANNEL_MISMATCH';
    END IF;
    IF selected_order.status = 'closed' THEN
        RETURN NEXT selected_order;
        RETURN;
    END IF;
    IF selected_order.status <> 'manual_review' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'RECHARGE_ORDER_STATE_CONFLICT';
    END IF;

    RETURN QUERY
    UPDATE billing.recharge_orders
    SET status = 'closed',
        closed_at = p_closed_at,
        review_reason = '用户取消充值申请',
        updated_at = p_closed_at,
        row_version = row_version + 1
    WHERE id = selected_order.id
    RETURNING *;
END;
$$;

REVOKE ALL ON FUNCTION billing.create_manual_recharge_order(
    uuid, varchar, uuid, uuid, varchar, timestamptz, varchar
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.approve_manual_recharge_order(
    uuid, uuid, varchar, timestamptz, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.reject_manual_recharge_order(
    uuid, uuid, varchar, timestamptz
) FROM PUBLIC;
REVOKE ALL ON FUNCTION billing.cancel_manual_recharge_order(
    uuid, uuid, timestamptz
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION billing.create_manual_recharge_order(
    uuid, varchar, uuid, uuid, varchar, timestamptz, varchar
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.approve_manual_recharge_order(
    uuid, uuid, varchar, timestamptz, uuid
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.reject_manual_recharge_order(
    uuid, uuid, varchar, timestamptz
) TO lingframe_app;
GRANT EXECUTE ON FUNCTION billing.cancel_manual_recharge_order(
    uuid, uuid, timestamptz
) TO lingframe_app;

COMMENT ON FUNCTION billing.approve_manual_recharge_order(
    uuid, uuid, varchar, timestamptz, uuid
) IS 'Atomically approves one desktop manual recharge request, credits the wallet and appends one immutable ledger entry.';
COMMENT ON FUNCTION billing.reject_manual_recharge_order(
    uuid, uuid, varchar, timestamptz
) IS 'Rejects one desktop manual recharge request without changing the wallet.';

