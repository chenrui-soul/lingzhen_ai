SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'model catalog rollback must run as lingframe_owner';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'model_catalog'
          AND pg_get_userbyid(nspowner) = 'lingframe_owner'
    ) THEN
        RAISE EXCEPTION 'model_catalog schema is missing or has an unexpected owner';
    END IF;
END
$$;

DROP TABLE model_catalog.tenant_models;
DROP TABLE model_catalog.catalog_version_items;
DROP TABLE model_catalog.catalog_versions;
DROP TABLE model_catalog.models;
DROP TABLE model_catalog.providers;

DROP FUNCTION model_catalog.prevent_published_model_delete();
DROP FUNCTION model_catalog.validate_catalog_version_completion();
DROP FUNCTION model_catalog.enforce_catalog_version_item_immutability();
DROP FUNCTION model_catalog.enforce_catalog_version_lifecycle();
DROP FUNCTION model_catalog.validate_catalog_publisher();
DROP FUNCTION model_catalog.protect_provider_state();
DROP FUNCTION model_catalog.enforce_model_provider_state();

DROP SCHEMA model_catalog;
