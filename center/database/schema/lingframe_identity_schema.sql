--
-- PostgreSQL database dump
--

\restrict 0fQ1iAoK9GFJ93fpJKO4Zja7UuebnmIgwY23kKtCSL8guxtEsOWbv7Q4breseZB

-- Dumped from database version 16.15
-- Dumped by pg_dump version 16.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: audit; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA audit;


--
-- Name: billing; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA billing;


--
-- Name: SCHEMA billing; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA billing IS '用户个人积分、充值、模型价格和任务计费账务域。';


--
-- Name: desktop_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA desktop_data;


--
-- Name: SCHEMA desktop_data; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA desktop_data IS '桌面端按当前租户与当前用户隔离的联网元数据。';


--
-- Name: identity; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA identity;


--
-- Name: model_catalog; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA model_catalog;


--
-- Name: SCHEMA model_catalog; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA model_catalog IS '平台模型目录、不可变发布快照和租户模型策略。';


--
-- Name: sync; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA sync;


--
-- Name: workspace; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA workspace;


--
-- Name: apply_sandbox_payment(uuid, character varying, character varying, bigint, timestamp with time zone, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.apply_sandbox_payment(p_order_id uuid, p_channel_trade_no character varying, p_event_id character varying, p_cash_amount_cents bigint, p_paid_at timestamp with time zone, p_ledger_id uuid) RETURNS TABLE(order_status character varying, idempotent_replay boolean, available_balance bigint, reserved_balance bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION apply_sandbox_payment(p_order_id uuid, p_channel_trade_no character varying, p_event_id character varying, p_cash_amount_cents bigint, p_paid_at timestamp with time zone, p_ledger_id uuid); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.apply_sandbox_payment(p_order_id uuid, p_channel_trade_no character varying, p_event_id character varying, p_cash_amount_cents bigint, p_paid_at timestamp with time zone, p_ledger_id uuid) IS 'Atomically marks a sandbox order paid, credits the wallet and appends one immutable ledger entry.';


--
-- Name: approve_manual_recharge_order(uuid, uuid, character varying, timestamp with time zone, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.approve_manual_recharge_order(p_order_id uuid, p_operator_user_id uuid, p_review_reason character varying, p_reviewed_at timestamp with time zone, p_ledger_id uuid) RETURNS TABLE(order_status character varying, idempotent_replay boolean, available_balance bigint, reserved_balance bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION approve_manual_recharge_order(p_order_id uuid, p_operator_user_id uuid, p_review_reason character varying, p_reviewed_at timestamp with time zone, p_ledger_id uuid); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.approve_manual_recharge_order(p_order_id uuid, p_operator_user_id uuid, p_review_reason character varying, p_reviewed_at timestamp with time zone, p_ledger_id uuid) IS 'Atomically approves one desktop manual recharge request, credits the wallet and appends one immutable ledger entry.';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: recharge_orders; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.recharge_orders (
    id uuid NOT NULL,
    order_no character varying(48) NOT NULL,
    user_id uuid NOT NULL,
    package_id uuid NOT NULL,
    package_code_snapshot character varying(64) NOT NULL,
    cash_amount_cents bigint NOT NULL,
    credit_amount bigint NOT NULL,
    bonus_credits bigint DEFAULT 0 NOT NULL,
    payment_channel character varying(32) NOT NULL,
    channel_trade_no character varying(128),
    status character varying(24) DEFAULT 'pending'::character varying NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    paid_at timestamp with time zone,
    closed_at timestamp with time zone,
    refund_requested_at timestamp with time zone,
    refunded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    submission_note character varying(500),
    reviewed_by_user_id uuid,
    reviewed_at timestamp with time zone,
    review_reason character varying(500),
    CONSTRAINT recharge_orders_bonus_ck CHECK ((bonus_credits >= 0)),
    CONSTRAINT recharge_orders_cash_ck CHECK ((cash_amount_cents > 0)),
    CONSTRAINT recharge_orders_channel_ck CHECK (((payment_channel)::text ~ '^[a-z][a-z0-9_.-]{1,31}$'::text)),
    CONSTRAINT recharge_orders_credit_ck CHECK ((credit_amount > 0)),
    CONSTRAINT recharge_orders_expiry_ck CHECK ((expires_at > created_at)),
    CONSTRAINT recharge_orders_idempotency_ck CHECK ((btrim((idempotency_key)::text) <> ''::text)),
    CONSTRAINT recharge_orders_no_ck CHECK (((order_no)::text ~ '^[A-Z0-9][A-Z0-9_-]{7,47}$'::text)),
    CONSTRAINT recharge_orders_package_code_ck CHECK (((package_code_snapshot)::text ~ '^[a-z][a-z0-9_.-]{2,63}$'::text)),
    CONSTRAINT recharge_orders_review_ck CHECK ((((reviewed_at IS NULL) AND (reviewed_by_user_id IS NULL)) OR ((reviewed_at IS NOT NULL) AND (reviewed_by_user_id IS NOT NULL)))),
    CONSTRAINT recharge_orders_review_reason_ck CHECK (((review_reason IS NULL) OR (btrim((review_reason)::text) <> ''::text))),
    CONSTRAINT recharge_orders_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT recharge_orders_status_ck CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'paid'::character varying, 'closed'::character varying, 'rejected'::character varying, 'refund_pending'::character varying, 'refunded'::character varying, 'manual_review'::character varying])::text[]))),
    CONSTRAINT recharge_orders_submission_note_ck CHECK (((submission_note IS NULL) OR (btrim((submission_note)::text) <> ''::text))),
    CONSTRAINT recharge_orders_trade_ck CHECK (((channel_trade_no IS NULL) OR (btrim((channel_trade_no)::text) <> ''::text)))
);


--
-- Name: TABLE recharge_orders; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.recharge_orders IS '充值订单与支付状态；支付成功只能由验签后的渠道事实驱动。';


--
-- Name: cancel_manual_recharge_order(uuid, uuid, timestamp with time zone); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.cancel_manual_recharge_order(p_order_id uuid, p_user_id uuid, p_closed_at timestamp with time zone) RETURNS SETOF billing.recharge_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: close_recharge_order(uuid, uuid, timestamp with time zone, boolean); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.close_recharge_order(p_order_id uuid, p_user_id uuid, p_closed_at timestamp with time zone, p_require_expired boolean) RETURNS SETOF billing.recharge_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: create_manual_recharge_order(uuid, character varying, uuid, uuid, character varying, timestamp with time zone, character varying); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.create_manual_recharge_order(p_id uuid, p_order_no character varying, p_user_id uuid, p_package_id uuid, p_idempotency_key character varying, p_expires_at timestamp with time zone, p_submission_note character varying) RETURNS SETOF billing.recharge_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: create_recharge_order(uuid, character varying, uuid, uuid, character varying, character varying, timestamp with time zone); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.create_recharge_order(p_id uuid, p_order_no character varying, p_user_id uuid, p_package_id uuid, p_payment_channel character varying, p_idempotency_key character varying, p_expires_at timestamp with time zone) RETURNS SETOF billing.recharge_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: recharge_packages; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.recharge_packages (
    id uuid NOT NULL,
    package_code character varying(64) NOT NULL,
    display_name character varying(120) NOT NULL,
    cash_amount_cents bigint NOT NULL,
    credit_amount bigint NOT NULL,
    bonus_credits bigint DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT recharge_packages_bonus_ck CHECK ((bonus_credits >= 0)),
    CONSTRAINT recharge_packages_cash_ck CHECK ((cash_amount_cents > 0)),
    CONSTRAINT recharge_packages_code_ck CHECK (((package_code)::text ~ '^[a-z][a-z0-9_.-]{2,63}$'::text)),
    CONSTRAINT recharge_packages_credit_ck CHECK ((credit_amount > 0)),
    CONSTRAINT recharge_packages_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT recharge_packages_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT recharge_packages_status_ck CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: TABLE recharge_packages; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.recharge_packages IS '服务端维护的充值套餐；客户端金额和积分仅作展示。';


--
-- Name: create_recharge_package(uuid, character varying, character varying, bigint, bigint, bigint, integer, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.create_recharge_package(p_id uuid, p_package_code character varying, p_display_name character varying, p_cash_amount_cents bigint, p_credit_amount bigint, p_bonus_credits bigint, p_sort_order integer, p_created_by_user_id uuid) RETURNS SETOF billing.recharge_packages
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: create_user_wallet_after_insert(); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.create_user_wallet_after_insert() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
    AS $$
BEGIN
    INSERT INTO billing.user_wallets (user_id)
    VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
    RETURN NEW;
END;
$$;


--
-- Name: grant_admin_credits(uuid, uuid, bigint, character varying, character varying, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.grant_admin_credits(p_user_id uuid, p_operator_user_id uuid, p_credits bigint, p_reason character varying, p_idempotency_key character varying, p_grant_id uuid) RETURNS TABLE(available_balance bigint, reserved_balance bigint, idempotent_replay boolean)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION grant_admin_credits(p_user_id uuid, p_operator_user_id uuid, p_credits bigint, p_reason character varying, p_idempotency_key character varying, p_grant_id uuid); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.grant_admin_credits(p_user_id uuid, p_operator_user_id uuid, p_credits bigint, p_reason character varying, p_idempotency_key character varying, p_grant_id uuid) IS 'Atomically grants user credits by an administrator and appends one immutable ledger entry.';


--
-- Name: prevent_immutable_record_mutation(); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.prevent_immutable_record_mutation() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'billing'
    AS $$
BEGIN
    RAISE EXCEPTION 'billing immutable records cannot be updated or deleted';
END;
$$;


--
-- Name: reject_manual_recharge_order(uuid, uuid, character varying, timestamp with time zone); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.reject_manual_recharge_order(p_order_id uuid, p_operator_user_id uuid, p_review_reason character varying, p_reviewed_at timestamp with time zone) RETURNS SETOF billing.recharge_orders
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION reject_manual_recharge_order(p_order_id uuid, p_operator_user_id uuid, p_review_reason character varying, p_reviewed_at timestamp with time zone); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.reject_manual_recharge_order(p_order_id uuid, p_operator_user_id uuid, p_review_reason character varying, p_reviewed_at timestamp with time zone) IS 'Rejects one desktop manual recharge request without changing the wallet.';


--
-- Name: release_platform_credits(uuid, character varying, character varying, character varying, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.release_platform_credits(p_reservation_id uuid, p_task_id character varying, p_attempt_id character varying, p_idempotency_key character varying, p_ledger_id uuid) RETURNS TABLE(reservation_id uuid, reservation_status character varying, idempotent_replay boolean, available_balance bigint, reserved_balance bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION release_platform_credits(p_reservation_id uuid, p_task_id character varying, p_attempt_id character varying, p_idempotency_key character varying, p_ledger_id uuid); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.release_platform_credits(p_reservation_id uuid, p_task_id character varying, p_attempt_id character varying, p_idempotency_key character varying, p_ledger_id uuid) IS 'Atomically release a reservation after an explicit platform task failure or cancellation.';


--
-- Name: reserve_platform_credits(uuid, uuid, uuid, character varying, character varying, character varying, uuid, bigint, character varying, timestamp with time zone, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.reserve_platform_credits(p_reservation_id uuid, p_user_id uuid, p_tenant_id uuid, p_task_id character varying, p_attempt_id character varying, p_client_request_id character varying, p_price_version_id uuid, p_reserved_credits bigint, p_idempotency_key character varying, p_expires_at timestamp with time zone, p_ledger_id uuid) RETURNS TABLE(reservation_id uuid, reservation_status character varying, idempotent_replay boolean, available_balance bigint, reserved_balance bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION reserve_platform_credits(p_reservation_id uuid, p_user_id uuid, p_tenant_id uuid, p_task_id character varying, p_attempt_id character varying, p_client_request_id character varying, p_price_version_id uuid, p_reserved_credits bigint, p_idempotency_key character varying, p_expires_at timestamp with time zone, p_ledger_id uuid); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.reserve_platform_credits(p_reservation_id uuid, p_user_id uuid, p_tenant_id uuid, p_task_id character varying, p_attempt_id character varying, p_client_request_id character varying, p_price_version_id uuid, p_reserved_credits bigint, p_idempotency_key character varying, p_expires_at timestamp with time zone, p_ledger_id uuid) IS 'Atomically reserve user credits for a platform model task.';


--
-- Name: model_price_versions; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.model_price_versions (
    id uuid NOT NULL,
    model_id uuid NOT NULL,
    version_no bigint NOT NULL,
    pricing_unit character varying(24) NOT NULL,
    base_credits bigint NOT NULL,
    max_reserve_credits bigint NOT NULL,
    price_rule jsonb DEFAULT '{}'::jsonb NOT NULL,
    content_hash character varying(64) NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    created_by_user_id uuid,
    activated_at timestamp with time zone,
    retired_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT model_price_versions_activation_ck CHECK (((((status)::text = 'draft'::text) AND (activated_at IS NULL) AND (retired_at IS NULL)) OR (((status)::text = 'active'::text) AND (activated_at IS NOT NULL) AND (retired_at IS NULL)) OR (((status)::text = 'retired'::text) AND (activated_at IS NOT NULL) AND (retired_at IS NOT NULL)))),
    CONSTRAINT model_price_versions_base_ck CHECK ((base_credits >= 0)),
    CONSTRAINT model_price_versions_hash_ck CHECK (((content_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT model_price_versions_reserve_ck CHECK (((max_reserve_credits >= base_credits) AND (max_reserve_credits > 0))),
    CONSTRAINT model_price_versions_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT model_price_versions_rule_ck CHECK ((jsonb_typeof(price_rule) = 'object'::text)),
    CONSTRAINT model_price_versions_status_ck CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'retired'::character varying])::text[]))),
    CONSTRAINT model_price_versions_unit_ck CHECK (((pricing_unit)::text = ANY ((ARRAY['request'::character varying, 'second'::character varying, 'image'::character varying, 'token'::character varying, 'custom'::character varying])::text[]))),
    CONSTRAINT model_price_versions_version_ck CHECK ((version_no > 0))
);


--
-- Name: TABLE model_price_versions; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.model_price_versions IS '平台模型版本化积分价格；任务固定提交时价格版本。';


--
-- Name: save_active_model_price(uuid, uuid, character varying, bigint, bigint, jsonb, uuid, bigint); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.save_active_model_price(p_id uuid, p_model_id uuid, p_pricing_unit character varying, p_base_credits bigint, p_max_reserve_credits bigint, p_price_rule jsonb, p_created_by_user_id uuid, p_expected_row_version bigint) RETURNS SETOF billing.model_price_versions
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing', 'model_catalog'
    AS $$
DECLARE
    current_price billing.model_price_versions%ROWTYPE;
    next_version bigint;
    payload text;
    had_current boolean := false;
BEGIN
    PERFORM 1 FROM model_catalog.models WHERE id = p_model_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MODEL_NOT_FOUND';
    END IF;
    IF p_pricing_unit NOT IN ('request', 'second', 'image', 'token', 'custom')
       OR p_base_credits < 0
       OR p_max_reserve_credits <= 0
       OR p_max_reserve_credits < p_base_credits
       OR jsonb_typeof(p_price_rule) <> 'object' THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MODEL_PRICE_INVALID';
    END IF;

    SELECT * INTO current_price
    FROM billing.model_price_versions
    WHERE model_id = p_model_id AND status = 'active'
    FOR UPDATE;

    IF FOUND AND p_expected_row_version IS NOT NULL
       AND current_price.row_version <> p_expected_row_version THEN
        RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'MODEL_PRICE_VERSION_CONFLICT';
    END IF;

    had_current := FOUND;

    IF FOUND
       AND current_price.pricing_unit = p_pricing_unit
       AND current_price.base_credits = p_base_credits
       AND current_price.max_reserve_credits = p_max_reserve_credits
       AND current_price.price_rule = p_price_rule THEN
        RETURN NEXT current_price;
        RETURN;
    END IF;

    SELECT coalesce(max(version_no), 0) + 1 INTO next_version
    FROM billing.model_price_versions WHERE model_id = p_model_id;
    payload := p_model_id::text || '|' || next_version::text || '|' || p_pricing_unit || '|'
        || p_base_credits::text || '|' || p_max_reserve_credits::text || '|' || p_price_rule::text;

    IF had_current THEN
        UPDATE billing.model_price_versions
        SET status = 'retired', retired_at = now(), updated_at = now(), row_version = row_version + 1
        WHERE id = current_price.id;
    END IF;

    RETURN QUERY
    INSERT INTO billing.model_price_versions (
        id, model_id, version_no, pricing_unit, base_credits, max_reserve_credits,
        price_rule, content_hash, status, created_by_user_id, activated_at
    ) VALUES (
        p_id, p_model_id, next_version, p_pricing_unit, p_base_credits, p_max_reserve_credits,
        p_price_rule, md5(payload) || md5(payload || ':2'), 'active', p_created_by_user_id, now()
    ) RETURNING *;
END;
$$;


--
-- Name: FUNCTION save_active_model_price(p_id uuid, p_model_id uuid, p_pricing_unit character varying, p_base_credits bigint, p_max_reserve_credits bigint, p_price_rule jsonb, p_created_by_user_id uuid, p_expected_row_version bigint); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.save_active_model_price(p_id uuid, p_model_id uuid, p_pricing_unit character varying, p_base_credits bigint, p_max_reserve_credits bigint, p_price_rule jsonb, p_created_by_user_id uuid, p_expected_row_version bigint) IS 'Creates an immutable active model price version and retires the previous active version.';


--
-- Name: settle_platform_credits(uuid, character varying, character varying, bigint, character varying, character varying, uuid, uuid); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.settle_platform_credits(p_reservation_id uuid, p_task_id character varying, p_attempt_id character varying, p_charged_credits bigint, p_result_reference character varying, p_idempotency_key character varying, p_settlement_id uuid, p_ledger_id uuid) RETURNS TABLE(reservation_id uuid, reservation_status character varying, idempotent_replay boolean, available_balance bigint, reserved_balance bigint)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: FUNCTION settle_platform_credits(p_reservation_id uuid, p_task_id character varying, p_attempt_id character varying, p_charged_credits bigint, p_result_reference character varying, p_idempotency_key character varying, p_settlement_id uuid, p_ledger_id uuid); Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON FUNCTION billing.settle_platform_credits(p_reservation_id uuid, p_task_id character varying, p_attempt_id character varying, p_charged_credits bigint, p_result_reference character varying, p_idempotency_key character varying, p_settlement_id uuid, p_ledger_id uuid) IS 'Atomically settle a successful platform model task and return any unused reservation.';


--
-- Name: update_recharge_package(uuid, character varying, bigint, bigint, bigint, character varying, integer, bigint); Type: FUNCTION; Schema: billing; Owner: -
--

CREATE FUNCTION billing.update_recharge_package(p_id uuid, p_display_name character varying, p_cash_amount_cents bigint, p_credit_amount bigint, p_bonus_credits bigint, p_status character varying, p_sort_order integer, p_row_version bigint) RETURNS SETOF billing.recharge_packages
    LANGUAGE sql SECURITY DEFINER
    SET search_path TO 'pg_catalog', 'billing'
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


--
-- Name: enforce_catalog_version_item_immutability(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.enforce_catalog_version_item_immutability() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog'
    AS $$
DECLARE
    version_published_at timestamptz;
BEGIN
    IF TG_OP <> 'INSERT' THEN
        RAISE EXCEPTION 'catalog version items are immutable'
            USING ERRCODE = '55000';
    END IF;

    SELECT version.published_at
    INTO version_published_at
    FROM model_catalog.catalog_versions AS version
    WHERE version.id = NEW.catalog_version_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'catalog version does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF version_published_at IS NOT NULL THEN
        RAISE EXCEPTION 'cannot append items to a published catalog version'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END
$$;


--
-- Name: enforce_catalog_version_lifecycle(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.enforce_catalog_version_lifecycle() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog'
    AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'published catalog versions cannot be deleted'
            USING ERRCODE = '55000';
    END IF;

    IF OLD.published_at IS NULL THEN
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.version_no IS DISTINCT FROM OLD.version_no
           OR NEW.content_hash IS DISTINCT FROM OLD.content_hash
           OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
           OR NEW.published_by_user_id IS DISTINCT FROM OLD.published_by_user_id
           OR NEW.published_by_membership_id IS DISTINCT FROM OLD.published_by_membership_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at
           OR (NEW.published_at IS NULL AND NEW.is_current) THEN
            RAISE EXCEPTION 'catalog version metadata is immutable while publication is being sealed'
                USING ERRCODE = '55000';
        END IF;
    ELSIF to_jsonb(NEW) - 'is_current' IS DISTINCT FROM to_jsonb(OLD) - 'is_current' THEN
        RAISE EXCEPTION 'published catalog version metadata is immutable'
            USING ERRCODE = '55000';
    END IF;

    RETURN NEW;
END
$$;


--
-- Name: enforce_model_provider_state(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.enforce_model_provider_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog'
    AS $$
BEGIN
    IF NEW.status = 'active'
       AND NOT EXISTS (
           SELECT 1
           FROM model_catalog.providers AS provider
           WHERE provider.id = NEW.provider_id
             AND provider.status = 'active'
       ) THEN
        RAISE EXCEPTION 'active model requires an active provider'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$$;


--
-- Name: prevent_published_model_delete(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.prevent_published_model_delete() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog'
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM model_catalog.catalog_version_items AS item
        WHERE item.model_id = OLD.id
    ) THEN
        RAISE EXCEPTION 'published models cannot be hard deleted'
            USING ERRCODE = '55000';
    END IF;

    RETURN OLD;
END
$$;


--
-- Name: protect_provider_state(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.protect_provider_state() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog'
    AS $$
BEGIN
    IF OLD.status = 'active'
       AND NEW.status <> 'active'
       AND EXISTS (
           SELECT 1
           FROM model_catalog.models AS model
           WHERE model.provider_id = OLD.id
             AND model.status = 'active'
       ) THEN
        RAISE EXCEPTION 'provider with active models cannot be deactivated'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END
$$;


--
-- Name: validate_catalog_publisher(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.validate_catalog_publisher() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog', 'identity'
    AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM identity.tenant_memberships AS membership
        WHERE membership.id = NEW.published_by_membership_id
          AND membership.user_id = NEW.published_by_user_id
          AND membership.status = 'active'
    ) THEN
        RAISE EXCEPTION 'catalog publisher must use an active Membership owned by the publishing user'
            USING ERRCODE = '23503';
    END IF;

    RETURN NEW;
END
$$;


--
-- Name: validate_catalog_version_completion(); Type: FUNCTION; Schema: model_catalog; Owner: -
--

CREATE FUNCTION model_catalog.validate_catalog_version_completion() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO 'pg_catalog', 'model_catalog'
    AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM model_catalog.catalog_versions AS version
        WHERE version.id = NEW.id
          AND (
              version.published_at IS NULL
              OR NOT EXISTS (
                  SELECT 1
                  FROM model_catalog.catalog_version_items AS item
                  WHERE item.catalog_version_id = version.id
              )
          )
    ) THEN
        RAISE EXCEPTION 'catalog version must be sealed with at least one snapshot item before commit'
            USING ERRCODE = '23514';
    END IF;

    RETURN NULL;
END
$$;


--
-- Name: credit_ledger_entries; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.credit_ledger_entries (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid,
    entry_type character varying(24) NOT NULL,
    available_delta bigint NOT NULL,
    reserved_delta bigint NOT NULL,
    available_after bigint NOT NULL,
    reserved_after bigint NOT NULL,
    business_type character varying(48) NOT NULL,
    business_id character varying(160) NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    recharge_order_id uuid,
    reservation_id uuid,
    settlement_id uuid,
    reversal_of_entry_id uuid,
    operator_user_id uuid,
    operator_membership_id uuid,
    reason character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_ledger_entries_adjustment_ck CHECK ((((entry_type)::text <> 'manual_adjustment'::text) OR ((operator_user_id IS NOT NULL) AND (reason IS NOT NULL) AND (btrim((reason)::text) <> ''::text)))),
    CONSTRAINT credit_ledger_entries_after_ck CHECK (((available_after >= 0) AND (reserved_after >= 0))),
    CONSTRAINT credit_ledger_entries_business_ck CHECK (((btrim((business_type)::text) <> ''::text) AND (btrim((business_id)::text) <> ''::text))),
    CONSTRAINT credit_ledger_entries_delta_ck CHECK (((available_delta <> 0) OR (reserved_delta <> 0))),
    CONSTRAINT credit_ledger_entries_idempotency_ck CHECK ((btrim((idempotency_key)::text) <> ''::text)),
    CONSTRAINT credit_ledger_entries_type_ck CHECK (((entry_type)::text = ANY ((ARRAY['migration'::character varying, 'recharge'::character varying, 'reserve'::character varying, 'settle'::character varying, 'release'::character varying, 'refund'::character varying, 'manual_adjustment'::character varying, 'reversal'::character varying])::text[])))
);


--
-- Name: TABLE credit_ledger_entries; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.credit_ledger_entries IS '积分审计真相源；只允许追加，不允许 UPDATE 或 DELETE。';


--
-- Name: credit_reservations; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.credit_reservations (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    task_id character varying(128) NOT NULL,
    attempt_id character varying(128) NOT NULL,
    client_request_id character varying(160) NOT NULL,
    price_version_id uuid NOT NULL,
    reserved_credits bigint NOT NULL,
    settled_credits bigint DEFAULT 0 NOT NULL,
    released_credits bigint DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'reserved'::character varying NOT NULL,
    idempotency_key character varying(160) NOT NULL,
    expires_at timestamp with time zone,
    settled_at timestamp with time zone,
    released_at timestamp with time zone,
    refunded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT credit_reservations_attempt_ck CHECK ((btrim((attempt_id)::text) <> ''::text)),
    CONSTRAINT credit_reservations_idempotency_ck CHECK ((btrim((idempotency_key)::text) <> ''::text)),
    CONSTRAINT credit_reservations_released_ck CHECK ((released_credits >= 0)),
    CONSTRAINT credit_reservations_request_ck CHECK ((btrim((client_request_id)::text) <> ''::text)),
    CONSTRAINT credit_reservations_reserved_ck CHECK ((reserved_credits > 0)),
    CONSTRAINT credit_reservations_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT credit_reservations_settled_ck CHECK ((settled_credits >= 0)),
    CONSTRAINT credit_reservations_status_ck CHECK (((status)::text = ANY ((ARRAY['reserved'::character varying, 'settled'::character varying, 'released'::character varying, 'refunded'::character varying])::text[]))),
    CONSTRAINT credit_reservations_task_ck CHECK ((btrim((task_id)::text) <> ''::text)),
    CONSTRAINT credit_reservations_total_ck CHECK (((settled_credits + released_credits) <= reserved_credits))
);


--
-- Name: TABLE credit_reservations; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.credit_reservations IS '平台模型任务积分预占；提交未知时保持 reserved。';


--
-- Name: credit_settlements; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.credit_settlements (
    id uuid NOT NULL,
    reservation_id uuid NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    task_id character varying(128) NOT NULL,
    attempt_id character varying(128) NOT NULL,
    charged_credits bigint NOT NULL,
    result_reference character varying(300),
    idempotency_key character varying(160) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT credit_settlements_attempt_ck CHECK ((btrim((attempt_id)::text) <> ''::text)),
    CONSTRAINT credit_settlements_charge_ck CHECK ((charged_credits > 0)),
    CONSTRAINT credit_settlements_idempotency_ck CHECK ((btrim((idempotency_key)::text) <> ''::text)),
    CONSTRAINT credit_settlements_result_ck CHECK (((result_reference IS NULL) OR (btrim((result_reference)::text) <> ''::text))),
    CONSTRAINT credit_settlements_task_ck CHECK ((btrim((task_id)::text) <> ''::text))
);


--
-- Name: TABLE credit_settlements; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.credit_settlements IS '任务成功后的不可变结算事实；同一任务最多一次。';


--
-- Name: user_wallets; Type: TABLE; Schema: billing; Owner: -
--

CREATE TABLE billing.user_wallets (
    user_id uuid NOT NULL,
    available_balance bigint DEFAULT 0 NOT NULL,
    reserved_balance bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT user_wallets_available_ck CHECK ((available_balance >= 0)),
    CONSTRAINT user_wallets_reserved_ck CHECK ((reserved_balance >= 0)),
    CONSTRAINT user_wallets_row_version_ck CHECK ((row_version >= 0))
);


--
-- Name: TABLE user_wallets; Type: COMMENT; Schema: billing; Owner: -
--

COMMENT ON TABLE billing.user_wallets IS '每个用户一个全局个人钱包；不按租户或设备拆分。';


--
-- Name: credit_accounts; Type: TABLE; Schema: desktop_data; Owner: -
--

CREATE TABLE desktop_data.credit_accounts (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    balance bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT credit_accounts_balance_ck CHECK ((balance >= 0)),
    CONSTRAINT credit_accounts_row_version_ck CHECK ((row_version >= 0))
);


--
-- Name: TABLE credit_accounts; Type: COMMENT; Schema: desktop_data; Owner: -
--

COMMENT ON TABLE desktop_data.credit_accounts IS '当前用户在当前租户的积分余额。';


--
-- Name: doubao_account_bindings; Type: TABLE; Schema: desktop_data; Owner: -
--

CREATE TABLE desktop_data.doubao_account_bindings (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    account_id character varying(80) NOT NULL,
    display_name character varying(100) NOT NULL,
    login_state character varying(24) DEFAULT 'unknown'::character varying NOT NULL,
    login_summary character varying(300),
    last_checked_at timestamp with time zone,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT doubao_account_bindings_account_ck CHECK (((account_id)::text ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$'::text)),
    CONSTRAINT doubao_account_bindings_login_state_ck CHECK (((login_state)::text = ANY ((ARRAY['unknown'::character varying, 'logged_in'::character varying, 'logged_out'::character varying, 'verification_required'::character varying])::text[]))),
    CONSTRAINT doubao_account_bindings_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT doubao_account_bindings_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT doubao_account_bindings_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'removed'::character varying])::text[])))
);


--
-- Name: TABLE doubao_account_bindings; Type: COMMENT; Schema: desktop_data; Owner: -
--

COMMENT ON TABLE desktop_data.doubao_account_bindings IS '豆包账号非敏感摘要；禁止保存 Cookie、partition 或浏览器路径。';


--
-- Name: platform_model_tasks; Type: TABLE; Schema: desktop_data; Owner: -
--

CREATE TABLE desktop_data.platform_model_tasks (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    model_id uuid NOT NULL,
    provider_code character varying(96) NOT NULL,
    creation_type character varying(16) NOT NULL,
    client_request_id character varying(128) NOT NULL,
    provider_job_id character varying(200),
    state character varying(32) NOT NULL,
    result_urls jsonb DEFAULT '[]'::jsonb NOT NULL,
    result_text text DEFAULT ''::text NOT NULL,
    error_code character varying(80) DEFAULT ''::character varying NOT NULL,
    error_message character varying(500) DEFAULT ''::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT platform_model_tasks_job_ck CHECK (((provider_job_id IS NULL) OR (btrim((provider_job_id)::text) <> ''::text))),
    CONSTRAINT platform_model_tasks_provider_ck CHECK ((btrim((provider_code)::text) <> ''::text)),
    CONSTRAINT platform_model_tasks_request_ck CHECK ((btrim((client_request_id)::text) <> ''::text)),
    CONSTRAINT platform_model_tasks_state_ck CHECK (((state)::text = ANY ((ARRAY['submitting'::character varying, 'pending'::character varying, 'completed'::character varying, 'failed'::character varying, 'cancelled'::character varying, 'submission_unknown'::character varying])::text[]))),
    CONSTRAINT platform_model_tasks_type_ck CHECK (((creation_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'audio'::character varying])::text[]))),
    CONSTRAINT platform_model_tasks_urls_ck CHECK (((jsonb_typeof(result_urls) = 'array'::text) AND (jsonb_array_length(result_urls) <= 20))),
    CONSTRAINT platform_model_tasks_version_ck CHECK ((row_version >= 0))
);


--
-- Name: TABLE platform_model_tasks; Type: COMMENT; Schema: desktop_data; Owner: -
--

COMMENT ON TABLE desktop_data.platform_model_tasks IS '平台模型服务端任务真相源；保存租户/用户归属、厂商任务标识和可恢复结果，不保存厂商密钥。';


--
-- Name: published_skills; Type: TABLE; Schema: desktop_data; Owner: -
--

CREATE TABLE desktop_data.published_skills (
    id uuid NOT NULL,
    skill_code character varying(96) NOT NULL,
    display_name character varying(160) NOT NULL,
    version character varying(40) NOT NULL,
    description character varying(500),
    status character varying(16) DEFAULT 'published'::character varying NOT NULL,
    published_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT published_skills_code_ck CHECK (((skill_code)::text ~ '^[a-z][a-z0-9_.-]{2,95}$'::text)),
    CONSTRAINT published_skills_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT published_skills_status_ck CHECK (((status)::text = ANY ((ARRAY['published'::character varying, 'disabled'::character varying])::text[]))),
    CONSTRAINT published_skills_version_ck CHECK ((btrim((version)::text) <> ''::text))
);


--
-- Name: TABLE published_skills; Type: COMMENT; Schema: desktop_data; Owner: -
--

COMMENT ON TABLE desktop_data.published_skills IS 'Bootstrap 可见的已发布 Skill 元数据，不包含执行包。';


--
-- Name: workspace_snapshots; Type: TABLE; Schema: desktop_data; Owner: -
--

CREATE TABLE desktop_data.workspace_snapshots (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    revision bigint DEFAULT 1 NOT NULL,
    snapshot jsonb NOT NULL,
    content_hash character varying(64) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_snapshots_hash_ck CHECK (((content_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT workspace_snapshots_json_ck CHECK ((jsonb_typeof(snapshot) = 'object'::text)),
    CONSTRAINT workspace_snapshots_revision_ck CHECK ((revision > 0))
);


--
-- Name: TABLE workspace_snapshots; Type: COMMENT; Schema: desktop_data; Owner: -
--

COMMENT ON TABLE desktop_data.workspace_snapshots IS '项目、对话、任务和素材的脱敏元数据快照，不保存本地文件。';


--
-- Name: devices; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.devices (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    client_type character varying(24) NOT NULL,
    device_hash character varying(64) NOT NULL,
    fingerprint_version smallint NOT NULL,
    display_name character varying(160),
    platform character varying(32),
    architecture character varying(32),
    app_version character varying(32),
    trust_status character varying(16) DEFAULT 'unknown'::character varying NOT NULL,
    first_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    blocked_at timestamp with time zone,
    blocked_reason character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT devices_blocked_state_ck CHECK (((((trust_status)::text = 'blocked'::text) AND (blocked_at IS NOT NULL) AND (btrim((blocked_reason)::text) <> ''::text)) OR (((trust_status)::text <> 'blocked'::text) AND (blocked_at IS NULL) AND (blocked_reason IS NULL)))),
    CONSTRAINT devices_client_type_ck CHECK (((client_type)::text = ANY ((ARRAY['desktop'::character varying, 'management_web'::character varying])::text[]))),
    CONSTRAINT devices_fingerprint_version_ck CHECK ((fingerprint_version > 0)),
    CONSTRAINT devices_hash_ck CHECK (((device_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT devices_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT devices_seen_order_ck CHECK ((last_seen_at >= first_seen_at)),
    CONSTRAINT devices_trust_status_ck CHECK (((trust_status)::text = ANY ((ARRAY['unknown'::character varying, 'trusted'::character varying, 'blocked'::character varying])::text[])))
);


--
-- Name: TABLE devices; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.devices IS '终端设备摘要；不保存原始硬件证据，也不绑定单个用户。';


--
-- Name: feature_policies; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.feature_policies (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    target_scope character varying(16) NOT NULL,
    target_membership_id uuid,
    feature_code character varying(96) NOT NULL,
    effect character varying(8) NOT NULL,
    policy jsonb DEFAULT '{}'::jsonb NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    reason character varying(500) NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    created_by_membership_id uuid NOT NULL,
    revoked_by_membership_id uuid,
    revoked_at timestamp with time zone,
    revoke_reason character varying(500),
    idempotency_key character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT feature_policies_code_ck CHECK (((feature_code)::text ~ '^[a-z][a-z0-9_.-]{2,95}$'::text)),
    CONSTRAINT feature_policies_effect_ck CHECK (((effect)::text = ANY ((ARRAY['enable'::character varying, 'disable'::character varying])::text[]))),
    CONSTRAINT feature_policies_idempotency_ck CHECK (((idempotency_key IS NULL) OR (btrim((idempotency_key)::text) <> ''::text))),
    CONSTRAINT feature_policies_json_ck CHECK ((jsonb_typeof(policy) = 'object'::text)),
    CONSTRAINT feature_policies_reason_ck CHECK ((btrim((reason)::text) <> ''::text)),
    CONSTRAINT feature_policies_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT feature_policies_state_ck CHECK (((((status)::text = 'active'::text) AND (revoked_by_membership_id IS NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (revoked_by_membership_id IS NOT NULL) AND (revoked_at IS NOT NULL) AND (btrim((revoke_reason)::text) <> ''::text)))),
    CONSTRAINT feature_policies_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying])::text[]))),
    CONSTRAINT feature_policies_target_ck CHECK (((((target_scope)::text = 'tenant'::text) AND (target_membership_id IS NULL)) OR (((target_scope)::text = 'membership'::text) AND (target_membership_id IS NOT NULL)))),
    CONSTRAINT feature_policies_target_scope_ck CHECK (((target_scope)::text = ANY ((ARRAY['tenant'::character varying, 'membership'::character varying])::text[]))),
    CONSTRAINT feature_policies_validity_ck CHECK (((valid_until IS NULL) OR (valid_until > valid_from)))
);


--
-- Name: TABLE feature_policies; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.feature_policies IS '租户或 Membership 级功能启停与范围策略。';


--
-- Name: permission_overrides; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.permission_overrides (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    target_scope character varying(16) NOT NULL,
    target_membership_id uuid,
    permission_id uuid NOT NULL,
    effect character varying(8) NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    reason character varying(500) NOT NULL,
    valid_from timestamp with time zone DEFAULT now() NOT NULL,
    valid_until timestamp with time zone,
    created_by_membership_id uuid NOT NULL,
    revoked_by_membership_id uuid,
    revoked_at timestamp with time zone,
    revoke_reason character varying(500),
    idempotency_key character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT permission_overrides_effect_ck CHECK (((effect)::text = ANY ((ARRAY['allow'::character varying, 'deny'::character varying])::text[]))),
    CONSTRAINT permission_overrides_idempotency_ck CHECK (((idempotency_key IS NULL) OR (btrim((idempotency_key)::text) <> ''::text))),
    CONSTRAINT permission_overrides_reason_ck CHECK ((btrim((reason)::text) <> ''::text)),
    CONSTRAINT permission_overrides_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT permission_overrides_state_ck CHECK (((((status)::text = 'active'::text) AND (revoked_by_membership_id IS NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (revoked_by_membership_id IS NOT NULL) AND (revoked_at IS NOT NULL) AND (btrim((revoke_reason)::text) <> ''::text)))),
    CONSTRAINT permission_overrides_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying])::text[]))),
    CONSTRAINT permission_overrides_target_ck CHECK (((((target_scope)::text = 'tenant'::text) AND (target_membership_id IS NULL)) OR (((target_scope)::text = 'membership'::text) AND (target_membership_id IS NOT NULL)))),
    CONSTRAINT permission_overrides_target_scope_ck CHECK (((target_scope)::text = ANY ((ARRAY['tenant'::character varying, 'membership'::character varying])::text[]))),
    CONSTRAINT permission_overrides_validity_ck CHECK (((valid_until IS NULL) OR (valid_until > valid_from)))
);


--
-- Name: TABLE permission_overrides; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.permission_overrides IS '租户或 Membership 级 permission allow/deny 覆盖；deny 由应用层优先。';


--
-- Name: permissions; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.permissions (
    id uuid NOT NULL,
    code character varying(96) NOT NULL,
    display_name character varying(120) NOT NULL,
    description text,
    client_type character varying(24) NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT permissions_client_type_ck CHECK (((client_type)::text = ANY ((ARRAY['desktop'::character varying, 'management_web'::character varying])::text[]))),
    CONSTRAINT permissions_code_ck CHECK (((code)::text ~ '^[a-z][a-z0-9_.-]{2,95}$'::text)),
    CONSTRAINT permissions_name_ck CHECK ((btrim((display_name)::text) <> ''::text))
);


--
-- Name: TABLE permissions; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.permissions IS '权限目录；client_type 标识权限所属终端域。';


--
-- Name: platform_role_assignments; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.platform_role_assignments (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    role_scope character varying(16) DEFAULT 'platform'::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    granted_by_user_id uuid,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT platform_role_assignments_revoked_state_ck CHECK (((((status)::text = 'active'::text) AND (revoked_at IS NULL) AND (revoked_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (btrim((revoked_reason)::text) <> ''::text)))),
    CONSTRAINT platform_role_assignments_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT platform_role_assignments_scope_ck CHECK (((role_scope)::text = 'platform'::text)),
    CONSTRAINT platform_role_assignments_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: TABLE platform_role_assignments; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.platform_role_assignments IS '平台全局角色分配；不复用租户 Membership。';


--
-- Name: refresh_tokens; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.refresh_tokens (
    id uuid NOT NULL,
    session_id uuid NOT NULL,
    family_id uuid NOT NULL,
    parent_token_id uuid,
    token_hash bytea NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT refresh_tokens_expiry_ck CHECK ((expires_at > issued_at)),
    CONSTRAINT refresh_tokens_hash_ck CHECK ((octet_length(token_hash) = 32)),
    CONSTRAINT refresh_tokens_state_ck CHECK (((((status)::text = 'active'::text) AND (consumed_at IS NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'rotated'::text) AND (consumed_at IS NOT NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (btrim((revoke_reason)::text) <> ''::text)) OR (((status)::text = 'reused'::text) AND (consumed_at IS NOT NULL) AND (revoked_at IS NOT NULL) AND (btrim((revoke_reason)::text) <> ''::text)))),
    CONSTRAINT refresh_tokens_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'rotated'::character varying, 'revoked'::character varying, 'reused'::character varying])::text[])))
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.refresh_tokens IS '只保存 Refresh Token 哈希和同 family 轮换链。';


--
-- Name: role_permissions; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.role_permissions (
    role_id uuid NOT NULL,
    permission_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: roles; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.roles (
    id uuid NOT NULL,
    code character varying(64) NOT NULL,
    display_name character varying(120) NOT NULL,
    description text,
    role_scope character varying(16) NOT NULL,
    is_system boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_code_ck CHECK (((code)::text ~ '^[a-z][a-z0-9_.-]{1,63}$'::text)),
    CONSTRAINT roles_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT roles_scope_ck CHECK (((role_scope)::text = ANY ((ARRAY['platform'::character varying, 'tenant'::character varying])::text[])))
);


--
-- Name: TABLE roles; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.roles IS '系统角色目录；platform 与 tenant 角色通过 role_scope 硬隔离。';


--
-- Name: tenant_invitations; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.tenant_invitations (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    target_email character varying(320),
    role_id uuid NOT NULL,
    role_scope character varying(16) DEFAULT 'tenant'::character varying NOT NULL,
    token_hash bytea NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    invited_by_membership_id uuid NOT NULL,
    accepted_by_membership_id uuid,
    expires_at timestamp with time zone NOT NULL,
    accepted_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason character varying(500),
    idempotency_key character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT tenant_invitations_email_ck CHECK (((target_email IS NULL) OR (btrim((target_email)::text) <> ''::text))),
    CONSTRAINT tenant_invitations_expiry_ck CHECK ((expires_at > created_at)),
    CONSTRAINT tenant_invitations_hash_ck CHECK ((octet_length(token_hash) = 32)),
    CONSTRAINT tenant_invitations_idempotency_ck CHECK (((idempotency_key IS NULL) OR (btrim((idempotency_key)::text) <> ''::text))),
    CONSTRAINT tenant_invitations_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT tenant_invitations_scope_ck CHECK (((role_scope)::text = 'tenant'::text)),
    CONSTRAINT tenant_invitations_state_ck CHECK (((((status)::text = 'pending'::text) AND (accepted_by_membership_id IS NULL) AND (accepted_at IS NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'accepted'::text) AND (accepted_by_membership_id IS NOT NULL) AND (accepted_at IS NOT NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'expired'::text) AND (accepted_by_membership_id IS NULL) AND (accepted_at IS NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (accepted_by_membership_id IS NULL) AND (accepted_at IS NULL) AND (revoked_at IS NOT NULL) AND (btrim((revoke_reason)::text) <> ''::text)))),
    CONSTRAINT tenant_invitations_status_ck CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'accepted'::character varying, 'expired'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: TABLE tenant_invitations; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.tenant_invitations IS '租户邀请；只保存一次性邀请票据哈希。';


--
-- Name: tenant_memberships; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.tenant_memberships (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    role_id uuid NOT NULL,
    role_scope character varying(16) DEFAULT 'tenant'::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    joined_at timestamp with time zone,
    removed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT tenant_memberships_joined_state_ck CHECK (((((status)::text = 'invited'::text) AND (joined_at IS NULL)) OR (((status)::text <> 'invited'::text) AND (joined_at IS NOT NULL)))),
    CONSTRAINT tenant_memberships_removed_state_ck CHECK (((((status)::text = 'removed'::text) AND (removed_at IS NOT NULL)) OR (((status)::text <> 'removed'::text) AND (removed_at IS NULL)))),
    CONSTRAINT tenant_memberships_role_scope_ck CHECK (((role_scope)::text = 'tenant'::text)),
    CONSTRAINT tenant_memberships_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT tenant_memberships_status_ck CHECK (((status)::text = ANY ((ARRAY['invited'::character varying, 'active'::character varying, 'suspended'::character varying, 'removed'::character varying])::text[])))
);


--
-- Name: TABLE tenant_memberships; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.tenant_memberships IS '用户加入租户后的单一租户角色和成员状态。';


--
-- Name: tenant_selection_ticket_memberships; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.tenant_selection_ticket_memberships (
    ticket_id uuid NOT NULL,
    user_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: TABLE tenant_selection_ticket_memberships; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.tenant_selection_ticket_memberships IS '租户选择票据允许选择的有效 Membership 白名单。';


--
-- Name: tenant_selection_tickets; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.tenant_selection_tickets (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_hash bytea NOT NULL,
    device_hash character varying(64) NOT NULL,
    fingerprint_version smallint NOT NULL,
    client_type character varying(24) NOT NULL,
    status character varying(16) DEFAULT 'pending'::character varying NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    consumed_at timestamp with time zone,
    revoked_at timestamp with time zone,
    revoke_reason character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT tenant_selection_tickets_client_type_ck CHECK (((client_type)::text = ANY ((ARRAY['desktop'::character varying, 'management_web'::character varying])::text[]))),
    CONSTRAINT tenant_selection_tickets_device_hash_ck CHECK (((device_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT tenant_selection_tickets_expiry_ck CHECK ((expires_at > created_at)),
    CONSTRAINT tenant_selection_tickets_fingerprint_version_ck CHECK ((fingerprint_version > 0)),
    CONSTRAINT tenant_selection_tickets_hash_ck CHECK ((octet_length(token_hash) = 32)),
    CONSTRAINT tenant_selection_tickets_state_ck CHECK (((((status)::text = 'pending'::text) AND (consumed_at IS NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'consumed'::text) AND (consumed_at IS NOT NULL) AND (revoked_at IS NULL) AND (revoke_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (consumed_at IS NULL) AND (revoked_at IS NOT NULL) AND (btrim((revoke_reason)::text) <> ''::text)))),
    CONSTRAINT tenant_selection_tickets_status_ck CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'consumed'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: TABLE tenant_selection_tickets; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.tenant_selection_tickets IS '多租户登录的一次性选择票据；消费前不创建正式 Session。';


--
-- Name: tenants; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.tenants (
    id uuid NOT NULL,
    tenant_code character varying(32) NOT NULL,
    display_name character varying(120) NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT tenants_code_ck CHECK (((tenant_code)::text ~ '^[a-z][a-z0-9_-]{2,31}$'::text)),
    CONSTRAINT tenants_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT tenants_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT tenants_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'suspended'::character varying, 'closed'::character varying])::text[])))
);


--
-- Name: TABLE tenants; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.tenants IS '租户边界；所有联网业务数据最终归属一个租户。';


--
-- Name: user_sessions; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.user_sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    membership_id uuid NOT NULL,
    device_id uuid NOT NULL,
    client_type character varying(24) NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    issued_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    last_seen_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    revoked_reason character varying(500),
    client_ip inet,
    user_agent character varying(500),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT user_sessions_client_type_ck CHECK (((client_type)::text = ANY ((ARRAY['desktop'::character varying, 'management_web'::character varying])::text[]))),
    CONSTRAINT user_sessions_expiry_ck CHECK ((expires_at > issued_at)),
    CONSTRAINT user_sessions_revoked_state_ck CHECK (((((status)::text = 'active'::text) AND (revoked_at IS NULL) AND (revoked_reason IS NULL)) OR (((status)::text = 'revoked'::text) AND (revoked_at IS NOT NULL) AND (btrim((revoked_reason)::text) <> ''::text)))),
    CONSTRAINT user_sessions_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT user_sessions_seen_ck CHECK ((last_seen_at >= issued_at)),
    CONSTRAINT user_sessions_status_ck CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'revoked'::character varying])::text[])))
);


--
-- Name: TABLE user_sessions; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.user_sessions IS '绑定用户、租户、Membership、设备和 client_type 的正式会话。';


--
-- Name: users; Type: TABLE; Schema: identity; Owner: -
--

CREATE TABLE identity.users (
    id uuid NOT NULL,
    username character varying(64),
    email character varying(320),
    password_hash text NOT NULL,
    password_algorithm character varying(16) DEFAULT 'argon2id'::character varying NOT NULL,
    status character varying(16) DEFAULT 'active'::character varying NOT NULL,
    failed_login_count integer DEFAULT 0 NOT NULL,
    locked_until timestamp with time zone,
    password_changed_at timestamp with time zone DEFAULT now() NOT NULL,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT users_email_ck CHECK (((email IS NULL) OR (btrim((email)::text) <> ''::text))),
    CONSTRAINT users_failed_login_count_ck CHECK ((failed_login_count >= 0)),
    CONSTRAINT users_identity_ck CHECK (((username IS NOT NULL) OR (email IS NOT NULL))),
    CONSTRAINT users_lock_state_ck CHECK ((((status)::text = 'locked'::text) OR (locked_until IS NULL))),
    CONSTRAINT users_password_algorithm_ck CHECK (((password_algorithm)::text = 'argon2id'::text)),
    CONSTRAINT users_password_hash_ck CHECK ((btrim(password_hash) <> ''::text)),
    CONSTRAINT users_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT users_status_ck CHECK (((status)::text = ANY ((ARRAY['pending'::character varying, 'active'::character varying, 'locked'::character varying, 'disabled'::character varying])::text[]))),
    CONSTRAINT users_username_ck CHECK (((username IS NULL) OR (btrim((username)::text) <> ''::text)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: identity; Owner: -
--

COMMENT ON TABLE identity.users IS '全局用户身份；密码仅保存 Argon2id 哈希。';


--
-- Name: catalog_version_items; Type: TABLE; Schema: model_catalog; Owner: -
--

CREATE TABLE model_catalog.catalog_version_items (
    id uuid NOT NULL,
    catalog_version_id uuid NOT NULL,
    model_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    provider_code character varying(64) NOT NULL,
    provider_display_name character varying(120) NOT NULL,
    provider_protocol_family character varying(32) NOT NULL,
    model_code character varying(128) NOT NULL,
    display_name character varying(160) NOT NULL,
    capability_type character varying(16) NOT NULL,
    description text,
    parameter_schema jsonb NOT NULL,
    default_parameters jsonb NOT NULL,
    default_tenant_enabled boolean NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_version_items_capability_type_ck CHECK (((capability_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'audio'::character varying])::text[]))),
    CONSTRAINT catalog_version_items_default_parameters_ck CHECK ((jsonb_typeof(default_parameters) = 'object'::text)),
    CONSTRAINT catalog_version_items_model_code_ck CHECK (((model_code)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'::text)),
    CONSTRAINT catalog_version_items_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT catalog_version_items_parameter_schema_ck CHECK ((jsonb_typeof(parameter_schema) = 'object'::text)),
    CONSTRAINT catalog_version_items_protocol_family_ck CHECK (((provider_protocol_family)::text = ANY ((ARRAY['openai_compatible'::character varying, 'anthropic_compatible'::character varying, 'custom_proxy'::character varying])::text[]))),
    CONSTRAINT catalog_version_items_provider_code_ck CHECK (((provider_code)::text ~ '^[a-z][a-z0-9_.-]{1,63}$'::text)),
    CONSTRAINT catalog_version_items_provider_name_ck CHECK ((btrim((provider_display_name)::text) <> ''::text)),
    CONSTRAINT catalog_version_items_sort_order_ck CHECK ((sort_order >= 0))
);


--
-- Name: TABLE catalog_version_items; Type: COMMENT; Schema: model_catalog; Owner: -
--

COMMENT ON TABLE model_catalog.catalog_version_items IS '发布版本的不可变模型快照。';


--
-- Name: catalog_versions; Type: TABLE; Schema: model_catalog; Owner: -
--

CREATE TABLE model_catalog.catalog_versions (
    id uuid NOT NULL,
    version_no bigint NOT NULL,
    is_current boolean DEFAULT false NOT NULL,
    content_hash character varying(64) NOT NULL,
    idempotency_key character varying(128) NOT NULL,
    published_by_user_id uuid NOT NULL,
    published_by_membership_id uuid NOT NULL,
    published_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT catalog_versions_hash_ck CHECK (((content_hash)::text ~ '^[0-9a-f]{64}$'::text)),
    CONSTRAINT catalog_versions_idempotency_ck CHECK ((btrim((idempotency_key)::text) <> ''::text)),
    CONSTRAINT catalog_versions_number_ck CHECK ((version_no > 0))
);


--
-- Name: TABLE catalog_versions; Type: COMMENT; Schema: model_catalog; Owner: -
--

COMMENT ON TABLE model_catalog.catalog_versions IS '目录发布版本；同事务写入快照后以 published_at 封存。';


--
-- Name: model_runtime_configs; Type: TABLE; Schema: model_catalog; Owner: -
--

CREATE TABLE model_catalog.model_runtime_configs (
    model_id uuid NOT NULL,
    base_url character varying(2048) NOT NULL,
    api_key_ciphertext text NOT NULL,
    submit_path character varying(512),
    status_path character varying(512),
    cancel_path character varying(512),
    timeout_seconds integer DEFAULT 120 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT model_runtime_base_url_ck CHECK (((base_url)::text ~ '^https?://'::text)),
    CONSTRAINT model_runtime_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT model_runtime_timeout_ck CHECK (((timeout_seconds >= 1) AND (timeout_seconds <= 600)))
);


--
-- Name: models; Type: TABLE; Schema: model_catalog; Owner: -
--

CREATE TABLE model_catalog.models (
    id uuid NOT NULL,
    provider_id uuid NOT NULL,
    model_code character varying(128) NOT NULL,
    display_name character varying(160) NOT NULL,
    capability_type character varying(16) NOT NULL,
    description text,
    parameter_schema jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_parameters jsonb DEFAULT '{}'::jsonb NOT NULL,
    default_tenant_enabled boolean DEFAULT false NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT models_capability_type_ck CHECK (((capability_type)::text = ANY ((ARRAY['text'::character varying, 'image'::character varying, 'video'::character varying, 'audio'::character varying])::text[]))),
    CONSTRAINT models_code_ck CHECK (((model_code)::text ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'::text)),
    CONSTRAINT models_default_parameters_ck CHECK ((jsonb_typeof(default_parameters) = 'object'::text)),
    CONSTRAINT models_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT models_parameter_schema_ck CHECK ((jsonb_typeof(parameter_schema) = 'object'::text)),
    CONSTRAINT models_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT models_sort_order_ck CHECK ((sort_order >= 0)),
    CONSTRAINT models_status_ck CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: TABLE models; Type: COMMENT; Schema: model_catalog; Owner: -
--

COMMENT ON TABLE model_catalog.models IS '平台模型草稿目录；新增模型默认不向租户启用。';


--
-- Name: providers; Type: TABLE; Schema: model_catalog; Owner: -
--

CREATE TABLE model_catalog.providers (
    id uuid NOT NULL,
    provider_code character varying(64) NOT NULL,
    display_name character varying(120) NOT NULL,
    protocol_family character varying(32) NOT NULL,
    description text,
    status character varying(16) DEFAULT 'draft'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT providers_code_ck CHECK (((provider_code)::text ~ '^[a-z][a-z0-9_.-]{1,63}$'::text)),
    CONSTRAINT providers_name_ck CHECK ((btrim((display_name)::text) <> ''::text)),
    CONSTRAINT providers_protocol_family_ck CHECK (((protocol_family)::text = ANY ((ARRAY['openai_compatible'::character varying, 'anthropic_compatible'::character varying, 'custom_proxy'::character varying])::text[]))),
    CONSTRAINT providers_row_version_ck CHECK ((row_version >= 0)),
    CONSTRAINT providers_status_ck CHECK (((status)::text = ANY ((ARRAY['draft'::character varying, 'active'::character varying, 'inactive'::character varying])::text[])))
);


--
-- Name: TABLE providers; Type: COMMENT; Schema: model_catalog; Owner: -
--

COMMENT ON TABLE model_catalog.providers IS '模型厂商非敏感目录；不保存凭据、私有 Base URL 或 Header。';


--
-- Name: tenant_models; Type: TABLE; Schema: model_catalog; Owner: -
--

CREATE TABLE model_catalog.tenant_models (
    id uuid NOT NULL,
    tenant_id uuid NOT NULL,
    model_id uuid NOT NULL,
    policy character varying(16) DEFAULT 'inherit'::character varying NOT NULL,
    updated_by_membership_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    row_version bigint DEFAULT 0 NOT NULL,
    CONSTRAINT tenant_models_policy_ck CHECK (((policy)::text = ANY ((ARRAY['inherit'::character varying, 'enabled'::character varying, 'hidden'::character varying])::text[]))),
    CONSTRAINT tenant_models_row_version_ck CHECK ((row_version >= 0))
);


--
-- Name: TABLE tenant_models; Type: COMMENT; Schema: model_catalog; Owner: -
--

COMMENT ON TABLE model_catalog.tenant_models IS '当前租户对稳定 model_id 的 inherit/enabled/hidden 策略。';


--
-- Name: schema_migrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.schema_migrations (
    version bigint NOT NULL,
    description text NOT NULL,
    checksum text NOT NULL,
    applied_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: service_metadata; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.service_metadata (
    metadata_key text NOT NULL,
    metadata_value jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: credit_ledger_entries credit_ledger_entries_business_idempotency_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_business_idempotency_uk UNIQUE (business_type, idempotency_key);


--
-- Name: credit_ledger_entries credit_ledger_entries_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_pkey PRIMARY KEY (id);


--
-- Name: credit_reservations credit_reservations_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_pkey PRIMARY KEY (id);


--
-- Name: credit_reservations credit_reservations_task_attempt_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_task_attempt_uk UNIQUE (task_id, attempt_id);


--
-- Name: credit_reservations credit_reservations_user_idempotency_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_user_idempotency_uk UNIQUE (user_id, idempotency_key);


--
-- Name: credit_reservations credit_reservations_user_request_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_user_request_uk UNIQUE (user_id, client_request_id);


--
-- Name: credit_settlements credit_settlements_idempotency_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_idempotency_uk UNIQUE (idempotency_key);


--
-- Name: credit_settlements credit_settlements_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_pkey PRIMARY KEY (id);


--
-- Name: credit_settlements credit_settlements_reservation_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_reservation_uk UNIQUE (reservation_id);


--
-- Name: credit_settlements credit_settlements_task_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_task_uk UNIQUE (task_id);


--
-- Name: model_price_versions model_price_versions_model_version_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.model_price_versions
    ADD CONSTRAINT model_price_versions_model_version_uk UNIQUE (model_id, version_no);


--
-- Name: model_price_versions model_price_versions_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.model_price_versions
    ADD CONSTRAINT model_price_versions_pkey PRIMARY KEY (id);


--
-- Name: recharge_orders recharge_orders_no_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_orders
    ADD CONSTRAINT recharge_orders_no_uk UNIQUE (order_no);


--
-- Name: recharge_orders recharge_orders_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_orders
    ADD CONSTRAINT recharge_orders_pkey PRIMARY KEY (id);


--
-- Name: recharge_orders recharge_orders_user_idempotency_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_orders
    ADD CONSTRAINT recharge_orders_user_idempotency_uk UNIQUE (user_id, idempotency_key);


--
-- Name: recharge_packages recharge_packages_code_uk; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_packages
    ADD CONSTRAINT recharge_packages_code_uk UNIQUE (package_code);


--
-- Name: recharge_packages recharge_packages_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_packages
    ADD CONSTRAINT recharge_packages_pkey PRIMARY KEY (id);


--
-- Name: user_wallets user_wallets_pkey; Type: CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.user_wallets
    ADD CONSTRAINT user_wallets_pkey PRIMARY KEY (user_id);


--
-- Name: credit_accounts credit_accounts_pkey; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.credit_accounts
    ADD CONSTRAINT credit_accounts_pkey PRIMARY KEY (id);


--
-- Name: credit_accounts credit_accounts_tenant_user_uk; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.credit_accounts
    ADD CONSTRAINT credit_accounts_tenant_user_uk UNIQUE (tenant_id, user_id);


--
-- Name: doubao_account_bindings doubao_account_bindings_pkey; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.doubao_account_bindings
    ADD CONSTRAINT doubao_account_bindings_pkey PRIMARY KEY (id);


--
-- Name: doubao_account_bindings doubao_account_bindings_tenant_user_account_uk; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.doubao_account_bindings
    ADD CONSTRAINT doubao_account_bindings_tenant_user_account_uk UNIQUE (tenant_id, user_id, account_id);


--
-- Name: platform_model_tasks platform_model_tasks_owner_request_uk; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.platform_model_tasks
    ADD CONSTRAINT platform_model_tasks_owner_request_uk UNIQUE (tenant_id, user_id, client_request_id);


--
-- Name: platform_model_tasks platform_model_tasks_pkey; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.platform_model_tasks
    ADD CONSTRAINT platform_model_tasks_pkey PRIMARY KEY (id);


--
-- Name: published_skills published_skills_code_version_uk; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.published_skills
    ADD CONSTRAINT published_skills_code_version_uk UNIQUE (skill_code, version);


--
-- Name: published_skills published_skills_pkey; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.published_skills
    ADD CONSTRAINT published_skills_pkey PRIMARY KEY (id);


--
-- Name: workspace_snapshots workspace_snapshots_pkey; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.workspace_snapshots
    ADD CONSTRAINT workspace_snapshots_pkey PRIMARY KEY (id);


--
-- Name: workspace_snapshots workspace_snapshots_tenant_user_uk; Type: CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.workspace_snapshots
    ADD CONSTRAINT workspace_snapshots_tenant_user_uk UNIQUE (tenant_id, user_id);


--
-- Name: devices devices_id_tenant_client_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.devices
    ADD CONSTRAINT devices_id_tenant_client_uk UNIQUE (id, tenant_id, client_type);


--
-- Name: devices devices_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.devices
    ADD CONSTRAINT devices_pkey PRIMARY KEY (id);


--
-- Name: devices devices_tenant_client_hash_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.devices
    ADD CONSTRAINT devices_tenant_client_hash_uk UNIQUE (tenant_id, client_type, device_hash);


--
-- Name: feature_policies feature_policies_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.feature_policies
    ADD CONSTRAINT feature_policies_pkey PRIMARY KEY (id);


--
-- Name: permission_overrides permission_overrides_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permission_overrides
    ADD CONSTRAINT permission_overrides_pkey PRIMARY KEY (id);


--
-- Name: permissions permissions_code_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permissions
    ADD CONSTRAINT permissions_code_uk UNIQUE (code);


--
-- Name: permissions permissions_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permissions
    ADD CONSTRAINT permissions_pkey PRIMARY KEY (id);


--
-- Name: platform_role_assignments platform_role_assignments_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.platform_role_assignments
    ADD CONSTRAINT platform_role_assignments_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_hash_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT refresh_tokens_hash_uk UNIQUE (token_hash);


--
-- Name: refresh_tokens refresh_tokens_id_family_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT refresh_tokens_id_family_uk UNIQUE (id, family_id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_id, permission_id);


--
-- Name: roles roles_code_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.roles
    ADD CONSTRAINT roles_code_uk UNIQUE (code);


--
-- Name: roles roles_id_scope_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.roles
    ADD CONSTRAINT roles_id_scope_uk UNIQUE (id, role_scope);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: tenant_invitations tenant_invitations_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_invitations
    ADD CONSTRAINT tenant_invitations_pkey PRIMARY KEY (id);


--
-- Name: tenant_invitations tenant_invitations_token_hash_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_invitations
    ADD CONSTRAINT tenant_invitations_token_hash_uk UNIQUE (token_hash);


--
-- Name: tenant_memberships tenant_memberships_id_tenant_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_id_tenant_uk UNIQUE (id, tenant_id);


--
-- Name: tenant_memberships tenant_memberships_id_tenant_user_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_id_tenant_user_uk UNIQUE (id, tenant_id, user_id);


--
-- Name: tenant_memberships tenant_memberships_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_pkey PRIMARY KEY (id);


--
-- Name: tenant_memberships tenant_memberships_tenant_user_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_user_uk UNIQUE (tenant_id, user_id);


--
-- Name: tenant_selection_ticket_memberships tenant_selection_ticket_memberships_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_ticket_memberships
    ADD CONSTRAINT tenant_selection_ticket_memberships_pkey PRIMARY KEY (ticket_id, membership_id);


--
-- Name: tenant_selection_ticket_memberships tenant_selection_ticket_memberships_ticket_tenant_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_ticket_memberships
    ADD CONSTRAINT tenant_selection_ticket_memberships_ticket_tenant_uk UNIQUE (ticket_id, tenant_id);


--
-- Name: tenant_selection_tickets tenant_selection_tickets_id_user_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_tickets
    ADD CONSTRAINT tenant_selection_tickets_id_user_uk UNIQUE (id, user_id);


--
-- Name: tenant_selection_tickets tenant_selection_tickets_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_tickets
    ADD CONSTRAINT tenant_selection_tickets_pkey PRIMARY KEY (id);


--
-- Name: tenant_selection_tickets tenant_selection_tickets_token_hash_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_tickets
    ADD CONSTRAINT tenant_selection_tickets_token_hash_uk UNIQUE (token_hash);


--
-- Name: tenants tenants_code_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenants
    ADD CONSTRAINT tenants_code_uk UNIQUE (tenant_code);


--
-- Name: tenants tenants_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenants
    ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);


--
-- Name: user_sessions user_sessions_id_tenant_uk; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_sessions
    ADD CONSTRAINT user_sessions_id_tenant_uk UNIQUE (id, tenant_id);


--
-- Name: user_sessions user_sessions_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_sessions
    ADD CONSTRAINT user_sessions_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: catalog_version_items catalog_version_items_pkey; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_version_items
    ADD CONSTRAINT catalog_version_items_pkey PRIMARY KEY (id);


--
-- Name: catalog_version_items catalog_version_items_version_code_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_version_items
    ADD CONSTRAINT catalog_version_items_version_code_uk UNIQUE (catalog_version_id, provider_code, model_code);


--
-- Name: catalog_version_items catalog_version_items_version_model_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_version_items
    ADD CONSTRAINT catalog_version_items_version_model_uk UNIQUE (catalog_version_id, model_id);


--
-- Name: catalog_versions catalog_versions_idempotency_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_versions
    ADD CONSTRAINT catalog_versions_idempotency_uk UNIQUE (idempotency_key);


--
-- Name: catalog_versions catalog_versions_number_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_versions
    ADD CONSTRAINT catalog_versions_number_uk UNIQUE (version_no);


--
-- Name: catalog_versions catalog_versions_pkey; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_versions
    ADD CONSTRAINT catalog_versions_pkey PRIMARY KEY (id);


--
-- Name: model_runtime_configs model_runtime_configs_pkey; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.model_runtime_configs
    ADD CONSTRAINT model_runtime_configs_pkey PRIMARY KEY (model_id);


--
-- Name: models models_id_provider_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.models
    ADD CONSTRAINT models_id_provider_uk UNIQUE (id, provider_id);


--
-- Name: models models_pkey; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.models
    ADD CONSTRAINT models_pkey PRIMARY KEY (id);


--
-- Name: models models_provider_code_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.models
    ADD CONSTRAINT models_provider_code_uk UNIQUE (provider_id, model_code);


--
-- Name: providers providers_code_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.providers
    ADD CONSTRAINT providers_code_uk UNIQUE (provider_code);


--
-- Name: providers providers_pkey; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.providers
    ADD CONSTRAINT providers_pkey PRIMARY KEY (id);


--
-- Name: tenant_models tenant_models_pkey; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.tenant_models
    ADD CONSTRAINT tenant_models_pkey PRIMARY KEY (id);


--
-- Name: tenant_models tenant_models_tenant_model_uk; Type: CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.tenant_models
    ADD CONSTRAINT tenant_models_tenant_model_uk UNIQUE (tenant_id, model_id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: service_metadata service_metadata_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.service_metadata
    ADD CONSTRAINT service_metadata_pkey PRIMARY KEY (metadata_key);


--
-- Name: credit_ledger_entries_business_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX credit_ledger_entries_business_idx ON billing.credit_ledger_entries USING btree (business_type, business_id, created_at DESC);


--
-- Name: credit_ledger_entries_reservation_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX credit_ledger_entries_reservation_idx ON billing.credit_ledger_entries USING btree (reservation_id, created_at) WHERE (reservation_id IS NOT NULL);


--
-- Name: credit_ledger_entries_user_created_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX credit_ledger_entries_user_created_idx ON billing.credit_ledger_entries USING btree (user_id, created_at DESC, id DESC);


--
-- Name: credit_reservations_status_expiry_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX credit_reservations_status_expiry_idx ON billing.credit_reservations USING btree (status, expires_at, id) WHERE ((status)::text = 'reserved'::text);


--
-- Name: credit_reservations_user_status_updated_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX credit_reservations_user_status_updated_idx ON billing.credit_reservations USING btree (user_id, status, updated_at DESC, id DESC);


--
-- Name: credit_settlements_user_created_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX credit_settlements_user_created_idx ON billing.credit_settlements USING btree (user_id, created_at DESC, id DESC);


--
-- Name: model_price_versions_active_model_ux; Type: INDEX; Schema: billing; Owner: -
--

CREATE UNIQUE INDEX model_price_versions_active_model_ux ON billing.model_price_versions USING btree (model_id) WHERE ((status)::text = 'active'::text);


--
-- Name: model_price_versions_model_status_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX model_price_versions_model_status_idx ON billing.model_price_versions USING btree (model_id, status, version_no DESC);


--
-- Name: recharge_orders_channel_trade_ux; Type: INDEX; Schema: billing; Owner: -
--

CREATE UNIQUE INDEX recharge_orders_channel_trade_ux ON billing.recharge_orders USING btree (payment_channel, channel_trade_no) WHERE (channel_trade_no IS NOT NULL);


--
-- Name: recharge_orders_manual_review_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX recharge_orders_manual_review_idx ON billing.recharge_orders USING btree (created_at, id) WHERE (((payment_channel)::text = 'manual_transfer'::text) AND ((status)::text = 'manual_review'::text));


--
-- Name: recharge_orders_pending_expiry_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX recharge_orders_pending_expiry_idx ON billing.recharge_orders USING btree (expires_at, id) WHERE ((status)::text = 'pending'::text);


--
-- Name: recharge_orders_user_status_created_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX recharge_orders_user_status_created_idx ON billing.recharge_orders USING btree (user_id, status, created_at DESC, id DESC);


--
-- Name: recharge_packages_status_sort_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX recharge_packages_status_sort_idx ON billing.recharge_packages USING btree (status, sort_order, cash_amount_cents);


--
-- Name: user_wallets_updated_idx; Type: INDEX; Schema: billing; Owner: -
--

CREATE INDEX user_wallets_updated_idx ON billing.user_wallets USING btree (updated_at DESC, user_id);


--
-- Name: doubao_account_bindings_owner_status_idx; Type: INDEX; Schema: desktop_data; Owner: -
--

CREATE INDEX doubao_account_bindings_owner_status_idx ON desktop_data.doubao_account_bindings USING btree (tenant_id, user_id, status, updated_at DESC);


--
-- Name: platform_model_tasks_owner_updated_idx; Type: INDEX; Schema: desktop_data; Owner: -
--

CREATE INDEX platform_model_tasks_owner_updated_idx ON desktop_data.platform_model_tasks USING btree (tenant_id, user_id, updated_at DESC, id DESC);


--
-- Name: platform_model_tasks_recovery_idx; Type: INDEX; Schema: desktop_data; Owner: -
--

CREATE INDEX platform_model_tasks_recovery_idx ON desktop_data.platform_model_tasks USING btree (state, updated_at, id) WHERE ((state)::text = ANY ((ARRAY['submitting'::character varying, 'pending'::character varying, 'submission_unknown'::character varying])::text[]));


--
-- Name: workspace_snapshots_updated_idx; Type: INDEX; Schema: desktop_data; Owner: -
--

CREATE INDEX workspace_snapshots_updated_idx ON desktop_data.workspace_snapshots USING btree (tenant_id, updated_at DESC);


--
-- Name: devices_tenant_trust_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX devices_tenant_trust_idx ON identity.devices USING btree (tenant_id, client_type, trust_status, last_seen_at DESC);


--
-- Name: feature_policies_active_target_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX feature_policies_active_target_ux ON identity.feature_policies USING btree (tenant_id, target_scope, COALESCE(target_membership_id, '00000000-0000-0000-0000-000000000000'::uuid), feature_code) WHERE ((status)::text = 'active'::text);


--
-- Name: feature_policies_effective_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX feature_policies_effective_idx ON identity.feature_policies USING btree (tenant_id, status, valid_from, valid_until);


--
-- Name: feature_policies_idempotency_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX feature_policies_idempotency_ux ON identity.feature_policies USING btree (tenant_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: permission_overrides_active_target_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX permission_overrides_active_target_ux ON identity.permission_overrides USING btree (tenant_id, target_scope, COALESCE(target_membership_id, '00000000-0000-0000-0000-000000000000'::uuid), permission_id) WHERE ((status)::text = 'active'::text);


--
-- Name: permission_overrides_effective_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX permission_overrides_effective_idx ON identity.permission_overrides USING btree (tenant_id, status, valid_from, valid_until);


--
-- Name: permission_overrides_idempotency_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX permission_overrides_idempotency_ux ON identity.permission_overrides USING btree (tenant_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: permissions_client_type_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX permissions_client_type_idx ON identity.permissions USING btree (client_type, code);


--
-- Name: platform_role_assignments_active_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX platform_role_assignments_active_ux ON identity.platform_role_assignments USING btree (user_id, role_id) WHERE ((status)::text = 'active'::text);


--
-- Name: platform_role_assignments_user_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX platform_role_assignments_user_idx ON identity.platform_role_assignments USING btree (user_id, status, granted_at DESC);


--
-- Name: refresh_tokens_expiry_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX refresh_tokens_expiry_idx ON identity.refresh_tokens USING btree (expires_at) WHERE ((status)::text = 'active'::text);


--
-- Name: refresh_tokens_family_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX refresh_tokens_family_idx ON identity.refresh_tokens USING btree (family_id, status, issued_at DESC);


--
-- Name: refresh_tokens_one_active_per_session_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX refresh_tokens_one_active_per_session_ux ON identity.refresh_tokens USING btree (session_id) WHERE ((status)::text = 'active'::text);


--
-- Name: tenant_invitations_expiry_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_invitations_expiry_idx ON identity.tenant_invitations USING btree (expires_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: tenant_invitations_idempotency_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX tenant_invitations_idempotency_ux ON identity.tenant_invitations USING btree (tenant_id, idempotency_key) WHERE (idempotency_key IS NOT NULL);


--
-- Name: tenant_invitations_pending_email_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX tenant_invitations_pending_email_ux ON identity.tenant_invitations USING btree (tenant_id, lower(btrim((target_email)::text))) WHERE ((target_email IS NOT NULL) AND ((status)::text = 'pending'::text));


--
-- Name: tenant_invitations_tenant_status_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_invitations_tenant_status_idx ON identity.tenant_invitations USING btree (tenant_id, status, created_at DESC);


--
-- Name: tenant_memberships_tenant_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_memberships_tenant_idx ON identity.tenant_memberships USING btree (tenant_id, status, created_at DESC);


--
-- Name: tenant_memberships_user_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_memberships_user_idx ON identity.tenant_memberships USING btree (user_id, status);


--
-- Name: tenant_selection_ticket_memberships_user_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_selection_ticket_memberships_user_idx ON identity.tenant_selection_ticket_memberships USING btree (user_id, ticket_id);


--
-- Name: tenant_selection_tickets_expiry_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_selection_tickets_expiry_idx ON identity.tenant_selection_tickets USING btree (expires_at) WHERE ((status)::text = 'pending'::text);


--
-- Name: tenant_selection_tickets_user_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX tenant_selection_tickets_user_idx ON identity.tenant_selection_tickets USING btree (user_id, status, expires_at DESC);


--
-- Name: user_sessions_device_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX user_sessions_device_idx ON identity.user_sessions USING btree (device_id, status, expires_at DESC);


--
-- Name: user_sessions_expiry_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX user_sessions_expiry_idx ON identity.user_sessions USING btree (expires_at) WHERE ((status)::text = 'active'::text);


--
-- Name: user_sessions_membership_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX user_sessions_membership_idx ON identity.user_sessions USING btree (membership_id, status, expires_at DESC);


--
-- Name: user_sessions_user_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX user_sessions_user_idx ON identity.user_sessions USING btree (user_id, status, expires_at DESC);


--
-- Name: users_email_normalized_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX users_email_normalized_ux ON identity.users USING btree (lower(btrim((email)::text))) WHERE (email IS NOT NULL);


--
-- Name: users_status_idx; Type: INDEX; Schema: identity; Owner: -
--

CREATE INDEX users_status_idx ON identity.users USING btree (status, created_at DESC);


--
-- Name: users_username_normalized_ux; Type: INDEX; Schema: identity; Owner: -
--

CREATE UNIQUE INDEX users_username_normalized_ux ON identity.users USING btree (lower(btrim((username)::text))) WHERE (username IS NOT NULL);


--
-- Name: catalog_version_items_order_idx; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE INDEX catalog_version_items_order_idx ON model_catalog.catalog_version_items USING btree (catalog_version_id, capability_type, sort_order, display_name);


--
-- Name: catalog_versions_one_current_ux; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE UNIQUE INDEX catalog_versions_one_current_ux ON model_catalog.catalog_versions USING btree (is_current) WHERE is_current;


--
-- Name: catalog_versions_published_idx; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE INDEX catalog_versions_published_idx ON model_catalog.catalog_versions USING btree (published_at DESC, version_no DESC);


--
-- Name: models_capability_status_sort_idx; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE INDEX models_capability_status_sort_idx ON model_catalog.models USING btree (capability_type, status, sort_order, display_name);


--
-- Name: models_provider_status_capability_idx; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE INDEX models_provider_status_capability_idx ON model_catalog.models USING btree (provider_id, status, capability_type, sort_order);


--
-- Name: providers_status_idx; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE INDEX providers_status_idx ON model_catalog.providers USING btree (status, updated_at DESC);


--
-- Name: tenant_models_tenant_policy_idx; Type: INDEX; Schema: model_catalog; Owner: -
--

CREATE INDEX tenant_models_tenant_policy_idx ON model_catalog.tenant_models USING btree (tenant_id, policy, updated_at DESC);


--
-- Name: credit_ledger_entries credit_ledger_entries_immutable_trg; Type: TRIGGER; Schema: billing; Owner: -
--

CREATE TRIGGER credit_ledger_entries_immutable_trg BEFORE DELETE OR UPDATE ON billing.credit_ledger_entries FOR EACH ROW EXECUTE FUNCTION billing.prevent_immutable_record_mutation();


--
-- Name: credit_settlements credit_settlements_immutable_trg; Type: TRIGGER; Schema: billing; Owner: -
--

CREATE TRIGGER credit_settlements_immutable_trg BEFORE DELETE OR UPDATE ON billing.credit_settlements FOR EACH ROW EXECUTE FUNCTION billing.prevent_immutable_record_mutation();


--
-- Name: users billing_user_wallet_after_insert_trg; Type: TRIGGER; Schema: identity; Owner: -
--

CREATE TRIGGER billing_user_wallet_after_insert_trg AFTER INSERT ON identity.users FOR EACH ROW EXECUTE FUNCTION billing.create_user_wallet_after_insert();


--
-- Name: catalog_version_items catalog_version_items_immutability_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE TRIGGER catalog_version_items_immutability_trg BEFORE INSERT OR DELETE OR UPDATE ON model_catalog.catalog_version_items FOR EACH ROW EXECUTE FUNCTION model_catalog.enforce_catalog_version_item_immutability();


--
-- Name: catalog_versions catalog_versions_completion_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE CONSTRAINT TRIGGER catalog_versions_completion_trg AFTER INSERT OR UPDATE ON model_catalog.catalog_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION model_catalog.validate_catalog_version_completion();


--
-- Name: catalog_versions catalog_versions_lifecycle_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE TRIGGER catalog_versions_lifecycle_trg BEFORE DELETE OR UPDATE ON model_catalog.catalog_versions FOR EACH ROW EXECUTE FUNCTION model_catalog.enforce_catalog_version_lifecycle();


--
-- Name: catalog_versions catalog_versions_publisher_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE TRIGGER catalog_versions_publisher_trg BEFORE INSERT OR UPDATE OF published_by_user_id, published_by_membership_id ON model_catalog.catalog_versions FOR EACH ROW EXECUTE FUNCTION model_catalog.validate_catalog_publisher();


--
-- Name: models models_provider_state_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE TRIGGER models_provider_state_trg BEFORE INSERT OR UPDATE OF provider_id, status ON model_catalog.models FOR EACH ROW EXECUTE FUNCTION model_catalog.enforce_model_provider_state();


--
-- Name: models models_published_delete_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE TRIGGER models_published_delete_trg BEFORE DELETE ON model_catalog.models FOR EACH ROW EXECUTE FUNCTION model_catalog.prevent_published_model_delete();


--
-- Name: providers providers_active_models_trg; Type: TRIGGER; Schema: model_catalog; Owner: -
--

CREATE TRIGGER providers_active_models_trg BEFORE UPDATE OF status ON model_catalog.providers FOR EACH ROW EXECUTE FUNCTION model_catalog.protect_provider_state();


--
-- Name: credit_ledger_entries credit_ledger_entries_operator_membership_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_operator_membership_id_fkey FOREIGN KEY (operator_membership_id) REFERENCES identity.tenant_memberships(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_operator_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_operator_user_id_fkey FOREIGN KEY (operator_user_id) REFERENCES identity.users(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_recharge_order_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_recharge_order_id_fkey FOREIGN KEY (recharge_order_id) REFERENCES billing.recharge_orders(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_reservation_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES billing.credit_reservations(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_reversal_of_entry_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_reversal_of_entry_id_fkey FOREIGN KEY (reversal_of_entry_id) REFERENCES billing.credit_ledger_entries(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_settlement_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_settlement_id_fkey FOREIGN KEY (settlement_id) REFERENCES billing.credit_settlements(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_tenant_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: credit_ledger_entries credit_ledger_entries_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_ledger_entries
    ADD CONSTRAINT credit_ledger_entries_user_id_fkey FOREIGN KEY (user_id) REFERENCES billing.user_wallets(user_id);


--
-- Name: credit_reservations credit_reservations_price_version_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_price_version_id_fkey FOREIGN KEY (price_version_id) REFERENCES billing.model_price_versions(id);


--
-- Name: credit_reservations credit_reservations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: credit_reservations credit_reservations_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_reservations
    ADD CONSTRAINT credit_reservations_user_id_fkey FOREIGN KEY (user_id) REFERENCES billing.user_wallets(user_id);


--
-- Name: credit_settlements credit_settlements_reservation_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_reservation_id_fkey FOREIGN KEY (reservation_id) REFERENCES billing.credit_reservations(id);


--
-- Name: credit_settlements credit_settlements_tenant_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: credit_settlements credit_settlements_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.credit_settlements
    ADD CONSTRAINT credit_settlements_user_id_fkey FOREIGN KEY (user_id) REFERENCES billing.user_wallets(user_id);


--
-- Name: model_price_versions model_price_versions_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.model_price_versions
    ADD CONSTRAINT model_price_versions_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES identity.users(id);


--
-- Name: model_price_versions model_price_versions_model_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.model_price_versions
    ADD CONSTRAINT model_price_versions_model_id_fkey FOREIGN KEY (model_id) REFERENCES model_catalog.models(id);


--
-- Name: recharge_orders recharge_orders_package_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_orders
    ADD CONSTRAINT recharge_orders_package_id_fkey FOREIGN KEY (package_id) REFERENCES billing.recharge_packages(id);


--
-- Name: recharge_orders recharge_orders_reviewed_by_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_orders
    ADD CONSTRAINT recharge_orders_reviewed_by_user_id_fkey FOREIGN KEY (reviewed_by_user_id) REFERENCES identity.users(id);


--
-- Name: recharge_orders recharge_orders_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_orders
    ADD CONSTRAINT recharge_orders_user_id_fkey FOREIGN KEY (user_id) REFERENCES billing.user_wallets(user_id);


--
-- Name: recharge_packages recharge_packages_created_by_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.recharge_packages
    ADD CONSTRAINT recharge_packages_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES identity.users(id);


--
-- Name: user_wallets user_wallets_user_id_fkey; Type: FK CONSTRAINT; Schema: billing; Owner: -
--

ALTER TABLE ONLY billing.user_wallets
    ADD CONSTRAINT user_wallets_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id);


--
-- Name: credit_accounts credit_accounts_membership_fk; Type: FK CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.credit_accounts
    ADD CONSTRAINT credit_accounts_membership_fk FOREIGN KEY (tenant_id, user_id) REFERENCES identity.tenant_memberships(tenant_id, user_id);


--
-- Name: doubao_account_bindings doubao_account_bindings_membership_fk; Type: FK CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.doubao_account_bindings
    ADD CONSTRAINT doubao_account_bindings_membership_fk FOREIGN KEY (tenant_id, user_id) REFERENCES identity.tenant_memberships(tenant_id, user_id);


--
-- Name: platform_model_tasks platform_model_tasks_membership_fk; Type: FK CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.platform_model_tasks
    ADD CONSTRAINT platform_model_tasks_membership_fk FOREIGN KEY (tenant_id, user_id) REFERENCES identity.tenant_memberships(tenant_id, user_id);


--
-- Name: platform_model_tasks platform_model_tasks_model_id_fkey; Type: FK CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.platform_model_tasks
    ADD CONSTRAINT platform_model_tasks_model_id_fkey FOREIGN KEY (model_id) REFERENCES model_catalog.models(id);


--
-- Name: workspace_snapshots workspace_snapshots_membership_fk; Type: FK CONSTRAINT; Schema: desktop_data; Owner: -
--

ALTER TABLE ONLY desktop_data.workspace_snapshots
    ADD CONSTRAINT workspace_snapshots_membership_fk FOREIGN KEY (tenant_id, user_id) REFERENCES identity.tenant_memberships(tenant_id, user_id);


--
-- Name: devices devices_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.devices
    ADD CONSTRAINT devices_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: feature_policies feature_policies_creator_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.feature_policies
    ADD CONSTRAINT feature_policies_creator_fk FOREIGN KEY (created_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: feature_policies feature_policies_revoker_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.feature_policies
    ADD CONSTRAINT feature_policies_revoker_fk FOREIGN KEY (revoked_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: feature_policies feature_policies_target_membership_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.feature_policies
    ADD CONSTRAINT feature_policies_target_membership_fk FOREIGN KEY (target_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: feature_policies feature_policies_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.feature_policies
    ADD CONSTRAINT feature_policies_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: permission_overrides permission_overrides_creator_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permission_overrides
    ADD CONSTRAINT permission_overrides_creator_fk FOREIGN KEY (created_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: permission_overrides permission_overrides_permission_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permission_overrides
    ADD CONSTRAINT permission_overrides_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES identity.permissions(id);


--
-- Name: permission_overrides permission_overrides_revoker_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permission_overrides
    ADD CONSTRAINT permission_overrides_revoker_fk FOREIGN KEY (revoked_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: permission_overrides permission_overrides_target_membership_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permission_overrides
    ADD CONSTRAINT permission_overrides_target_membership_fk FOREIGN KEY (target_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: permission_overrides permission_overrides_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.permission_overrides
    ADD CONSTRAINT permission_overrides_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: platform_role_assignments platform_role_assignments_granted_by_user_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.platform_role_assignments
    ADD CONSTRAINT platform_role_assignments_granted_by_user_id_fkey FOREIGN KEY (granted_by_user_id) REFERENCES identity.users(id);


--
-- Name: platform_role_assignments platform_role_assignments_role_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.platform_role_assignments
    ADD CONSTRAINT platform_role_assignments_role_fk FOREIGN KEY (role_id, role_scope) REFERENCES identity.roles(id, role_scope);


--
-- Name: platform_role_assignments platform_role_assignments_user_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.platform_role_assignments
    ADD CONSTRAINT platform_role_assignments_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id);


--
-- Name: refresh_tokens refresh_tokens_parent_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT refresh_tokens_parent_fk FOREIGN KEY (parent_token_id, family_id) REFERENCES identity.refresh_tokens(id, family_id);


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES identity.user_sessions(id);


--
-- Name: role_permissions role_permissions_permission_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.role_permissions
    ADD CONSTRAINT role_permissions_permission_id_fkey FOREIGN KEY (permission_id) REFERENCES identity.permissions(id);


--
-- Name: role_permissions role_permissions_role_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.role_permissions
    ADD CONSTRAINT role_permissions_role_id_fkey FOREIGN KEY (role_id) REFERENCES identity.roles(id);


--
-- Name: tenant_invitations tenant_invitations_acceptor_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_invitations
    ADD CONSTRAINT tenant_invitations_acceptor_fk FOREIGN KEY (accepted_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: tenant_invitations tenant_invitations_inviter_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_invitations
    ADD CONSTRAINT tenant_invitations_inviter_fk FOREIGN KEY (invited_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: tenant_invitations tenant_invitations_role_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_invitations
    ADD CONSTRAINT tenant_invitations_role_fk FOREIGN KEY (role_id, role_scope) REFERENCES identity.roles(id, role_scope);


--
-- Name: tenant_invitations tenant_invitations_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_invitations
    ADD CONSTRAINT tenant_invitations_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: tenant_memberships tenant_memberships_role_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_role_fk FOREIGN KEY (role_id, role_scope) REFERENCES identity.roles(id, role_scope);


--
-- Name: tenant_memberships tenant_memberships_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: tenant_memberships tenant_memberships_user_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_memberships
    ADD CONSTRAINT tenant_memberships_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id);


--
-- Name: tenant_selection_ticket_memberships tenant_selection_ticket_memberships_membership_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_ticket_memberships
    ADD CONSTRAINT tenant_selection_ticket_memberships_membership_fk FOREIGN KEY (membership_id, tenant_id, user_id) REFERENCES identity.tenant_memberships(id, tenant_id, user_id);


--
-- Name: tenant_selection_ticket_memberships tenant_selection_ticket_memberships_ticket_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_ticket_memberships
    ADD CONSTRAINT tenant_selection_ticket_memberships_ticket_fk FOREIGN KEY (ticket_id, user_id) REFERENCES identity.tenant_selection_tickets(id, user_id);


--
-- Name: tenant_selection_tickets tenant_selection_tickets_user_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.tenant_selection_tickets
    ADD CONSTRAINT tenant_selection_tickets_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id);


--
-- Name: user_sessions user_sessions_device_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_sessions
    ADD CONSTRAINT user_sessions_device_fk FOREIGN KEY (device_id, tenant_id, client_type) REFERENCES identity.devices(id, tenant_id, client_type);


--
-- Name: user_sessions user_sessions_membership_fk; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_sessions
    ADD CONSTRAINT user_sessions_membership_fk FOREIGN KEY (membership_id, tenant_id, user_id) REFERENCES identity.tenant_memberships(id, tenant_id, user_id);


--
-- Name: user_sessions user_sessions_tenant_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_sessions
    ADD CONSTRAINT user_sessions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- Name: user_sessions user_sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: identity; Owner: -
--

ALTER TABLE ONLY identity.user_sessions
    ADD CONSTRAINT user_sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES identity.users(id);


--
-- Name: catalog_version_items catalog_version_items_catalog_version_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_version_items
    ADD CONSTRAINT catalog_version_items_catalog_version_id_fkey FOREIGN KEY (catalog_version_id) REFERENCES model_catalog.catalog_versions(id);


--
-- Name: catalog_version_items catalog_version_items_model_fk; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_version_items
    ADD CONSTRAINT catalog_version_items_model_fk FOREIGN KEY (model_id, provider_id) REFERENCES model_catalog.models(id, provider_id);


--
-- Name: catalog_versions catalog_versions_published_by_membership_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_versions
    ADD CONSTRAINT catalog_versions_published_by_membership_id_fkey FOREIGN KEY (published_by_membership_id) REFERENCES identity.tenant_memberships(id);


--
-- Name: catalog_versions catalog_versions_published_by_user_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.catalog_versions
    ADD CONSTRAINT catalog_versions_published_by_user_id_fkey FOREIGN KEY (published_by_user_id) REFERENCES identity.users(id);


--
-- Name: model_runtime_configs model_runtime_configs_model_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.model_runtime_configs
    ADD CONSTRAINT model_runtime_configs_model_id_fkey FOREIGN KEY (model_id) REFERENCES model_catalog.models(id) ON DELETE CASCADE;


--
-- Name: models models_provider_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.models
    ADD CONSTRAINT models_provider_id_fkey FOREIGN KEY (provider_id) REFERENCES model_catalog.providers(id);


--
-- Name: tenant_models tenant_models_model_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.tenant_models
    ADD CONSTRAINT tenant_models_model_id_fkey FOREIGN KEY (model_id) REFERENCES model_catalog.models(id);


--
-- Name: tenant_models tenant_models_operator_fk; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.tenant_models
    ADD CONSTRAINT tenant_models_operator_fk FOREIGN KEY (updated_by_membership_id, tenant_id) REFERENCES identity.tenant_memberships(id, tenant_id);


--
-- Name: tenant_models tenant_models_tenant_id_fkey; Type: FK CONSTRAINT; Schema: model_catalog; Owner: -
--

ALTER TABLE ONLY model_catalog.tenant_models
    ADD CONSTRAINT tenant_models_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES identity.tenants(id);


--
-- PostgreSQL database dump complete
--

\unrestrict 0fQ1iAoK9GFJ93fpJKO4Zja7UuebnmIgwY23kKtCSL8guxtEsOWbv7Q4breseZB

