SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'identity rollback must run as lingframe_owner';
    END IF;
END
$$;

DROP TABLE IF EXISTS identity.refresh_tokens;
DROP TABLE IF EXISTS identity.user_sessions;
DROP TABLE IF EXISTS identity.devices;
DROP TABLE IF EXISTS identity.platform_role_assignments;
DROP TABLE IF EXISTS identity.tenant_memberships;
DROP TABLE IF EXISTS identity.role_permissions;
DROP TABLE IF EXISTS identity.permissions;
DROP TABLE IF EXISTS identity.roles;
DROP TABLE IF EXISTS identity.users;
DROP TABLE IF EXISTS identity.tenants;
