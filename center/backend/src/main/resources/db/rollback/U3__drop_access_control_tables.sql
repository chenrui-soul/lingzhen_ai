SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'access control rollback must run as lingframe_owner';
    END IF;
END
$$;

DROP TABLE IF EXISTS identity.feature_policies;
DROP TABLE IF EXISTS identity.permission_overrides;
DROP TABLE IF EXISTS identity.tenant_selection_ticket_memberships;
DROP TABLE IF EXISTS identity.tenant_selection_tickets;
DROP TABLE IF EXISTS identity.tenant_invitations;
