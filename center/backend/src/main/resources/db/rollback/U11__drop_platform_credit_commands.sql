DROP FUNCTION IF EXISTS billing.release_platform_credits(uuid, varchar, varchar, varchar, uuid);
DROP FUNCTION IF EXISTS billing.settle_platform_credits(uuid, varchar, varchar, bigint, varchar, varchar, uuid, uuid);
DROP FUNCTION IF EXISTS billing.reserve_platform_credits(uuid, uuid, uuid, varchar, varchar, varchar, uuid, bigint, varchar, timestamptz, uuid);
