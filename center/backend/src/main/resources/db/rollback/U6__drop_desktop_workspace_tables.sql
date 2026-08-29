SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'desktop workspace rollback must run as lingframe_owner';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_namespace
        WHERE nspname = 'desktop_data'
          AND pg_get_userbyid(nspowner) = 'lingframe_owner'
    ) THEN
        RAISE EXCEPTION 'desktop_data schema is missing or has an unexpected owner';
    END IF;
END
$$;

DROP TABLE desktop_data.published_skills;
DROP TABLE desktop_data.credit_accounts;
DROP TABLE desktop_data.doubao_account_bindings;
DROP TABLE desktop_data.workspace_snapshots;
DROP SCHEMA desktop_data;
