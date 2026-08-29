SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'recharge payment rollback must run as lingframe_owner';
    END IF;
END
$$;

DROP FUNCTION billing.apply_sandbox_payment(uuid, varchar, varchar, bigint, timestamptz, uuid);
DROP FUNCTION billing.close_recharge_order(uuid, uuid, timestamptz, boolean);
DROP FUNCTION billing.create_recharge_order(uuid, varchar, uuid, uuid, varchar, varchar, timestamptz);
DROP FUNCTION billing.update_recharge_package(uuid, varchar, bigint, bigint, bigint, varchar, integer, bigint);
DROP FUNCTION billing.create_recharge_package(uuid, varchar, varchar, bigint, bigint, bigint, integer, uuid);
