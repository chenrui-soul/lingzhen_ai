SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'model price command migration must run as lingframe_owner';
    END IF;
    IF to_regclass('billing.model_price_versions') IS NULL THEN
        RAISE EXCEPTION 'model price command migration requires billing V7 state';
    END IF;
END
$$;

CREATE FUNCTION billing.save_active_model_price(
    p_id uuid,
    p_model_id uuid,
    p_pricing_unit varchar,
    p_base_credits bigint,
    p_max_reserve_credits bigint,
    p_price_rule jsonb,
    p_created_by_user_id uuid,
    p_expected_row_version bigint
)
RETURNS SETOF billing.model_price_versions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, billing, model_catalog
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

REVOKE ALL ON FUNCTION billing.save_active_model_price(
    uuid, uuid, varchar, bigint, bigint, jsonb, uuid, bigint
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION billing.save_active_model_price(
    uuid, uuid, varchar, bigint, bigint, jsonb, uuid, bigint
) TO lingframe_app;

COMMENT ON FUNCTION billing.save_active_model_price(uuid, uuid, varchar, bigint, bigint, jsonb, uuid, bigint)
    IS 'Creates an immutable active model price version and retires the previous active version.';
