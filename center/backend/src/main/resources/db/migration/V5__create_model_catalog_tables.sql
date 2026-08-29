SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'model catalog migrations must run as lingframe_owner';
    END IF;

    IF to_regnamespace('model_catalog') IS NOT NULL THEN
        RAISE EXCEPTION 'model_catalog schema already exists';
    END IF;
END
$$;

CREATE SCHEMA model_catalog AUTHORIZATION lingframe_owner;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_namespace
        WHERE nspname = 'model_catalog'
          AND pg_get_userbyid(nspowner) = 'lingframe_owner'
    ) THEN
        RAISE EXCEPTION 'model_catalog schema has an unexpected owner';
    END IF;
END
$$;

REVOKE ALL ON SCHEMA model_catalog FROM PUBLIC, lingframe_app;
GRANT USAGE ON SCHEMA model_catalog TO lingframe_app;

CREATE TABLE model_catalog.providers (
    id uuid PRIMARY KEY,
    provider_code varchar(64) NOT NULL,
    display_name varchar(120) NOT NULL,
    protocol_family varchar(32) NOT NULL,
    description text,
    status varchar(16) NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT providers_code_ck
        CHECK (provider_code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
    CONSTRAINT providers_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT providers_protocol_family_ck
        CHECK (protocol_family IN ('openai_compatible', 'anthropic_compatible', 'custom_proxy')),
    CONSTRAINT providers_status_ck CHECK (status IN ('draft', 'active', 'inactive')),
    CONSTRAINT providers_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT providers_code_uk UNIQUE (provider_code)
);

CREATE INDEX providers_status_idx
    ON model_catalog.providers (status, updated_at DESC);

CREATE TABLE model_catalog.models (
    id uuid PRIMARY KEY,
    provider_id uuid NOT NULL REFERENCES model_catalog.providers (id),
    model_code varchar(128) NOT NULL,
    display_name varchar(160) NOT NULL,
    capability_type varchar(16) NOT NULL,
    description text,
    parameter_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
    default_parameters jsonb NOT NULL DEFAULT '{}'::jsonb,
    default_tenant_enabled boolean NOT NULL DEFAULT false,
    sort_order integer NOT NULL DEFAULT 0,
    status varchar(16) NOT NULL DEFAULT 'draft',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT models_code_ck
        CHECK (model_code ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
    CONSTRAINT models_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT models_capability_type_ck
        CHECK (capability_type IN ('text', 'image', 'video', 'audio')),
    CONSTRAINT models_parameter_schema_ck CHECK (jsonb_typeof(parameter_schema) = 'object'),
    CONSTRAINT models_default_parameters_ck CHECK (jsonb_typeof(default_parameters) = 'object'),
    CONSTRAINT models_sort_order_ck CHECK (sort_order >= 0),
    CONSTRAINT models_status_ck CHECK (status IN ('draft', 'active', 'inactive')),
    CONSTRAINT models_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT models_provider_code_uk UNIQUE (provider_id, model_code),
    CONSTRAINT models_id_provider_uk UNIQUE (id, provider_id)
);

CREATE INDEX models_provider_status_capability_idx
    ON model_catalog.models (provider_id, status, capability_type, sort_order);

CREATE INDEX models_capability_status_sort_idx
    ON model_catalog.models (capability_type, status, sort_order, display_name);

CREATE TABLE model_catalog.catalog_versions (
    id uuid PRIMARY KEY,
    version_no bigint NOT NULL,
    is_current boolean NOT NULL DEFAULT false,
    content_hash varchar(64) NOT NULL,
    idempotency_key varchar(128) NOT NULL,
    published_by_user_id uuid NOT NULL REFERENCES identity.users (id),
    published_by_membership_id uuid NOT NULL REFERENCES identity.tenant_memberships (id),
    published_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_versions_number_ck CHECK (version_no > 0),
    CONSTRAINT catalog_versions_hash_ck CHECK (content_hash ~ '^[0-9a-f]{64}$'),
    CONSTRAINT catalog_versions_idempotency_ck CHECK (btrim(idempotency_key) <> ''),
    CONSTRAINT catalog_versions_number_uk UNIQUE (version_no),
    CONSTRAINT catalog_versions_idempotency_uk UNIQUE (idempotency_key)
);

CREATE UNIQUE INDEX catalog_versions_one_current_ux
    ON model_catalog.catalog_versions (is_current)
    WHERE is_current;

CREATE INDEX catalog_versions_published_idx
    ON model_catalog.catalog_versions (published_at DESC, version_no DESC);

CREATE TABLE model_catalog.catalog_version_items (
    id uuid PRIMARY KEY,
    catalog_version_id uuid NOT NULL REFERENCES model_catalog.catalog_versions (id),
    model_id uuid NOT NULL,
    provider_id uuid NOT NULL,
    provider_code varchar(64) NOT NULL,
    provider_display_name varchar(120) NOT NULL,
    provider_protocol_family varchar(32) NOT NULL,
    model_code varchar(128) NOT NULL,
    display_name varchar(160) NOT NULL,
    capability_type varchar(16) NOT NULL,
    description text,
    parameter_schema jsonb NOT NULL,
    default_parameters jsonb NOT NULL,
    default_tenant_enabled boolean NOT NULL,
    sort_order integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT catalog_version_items_model_fk
        FOREIGN KEY (model_id, provider_id)
        REFERENCES model_catalog.models (id, provider_id),
    CONSTRAINT catalog_version_items_provider_code_ck
        CHECK (provider_code ~ '^[a-z][a-z0-9_.-]{1,63}$'),
    CONSTRAINT catalog_version_items_provider_name_ck
        CHECK (btrim(provider_display_name) <> ''),
    CONSTRAINT catalog_version_items_protocol_family_ck
        CHECK (provider_protocol_family IN ('openai_compatible', 'anthropic_compatible', 'custom_proxy')),
    CONSTRAINT catalog_version_items_model_code_ck
        CHECK (model_code ~ '^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$'),
    CONSTRAINT catalog_version_items_name_ck CHECK (btrim(display_name) <> ''),
    CONSTRAINT catalog_version_items_capability_type_ck
        CHECK (capability_type IN ('text', 'image', 'video', 'audio')),
    CONSTRAINT catalog_version_items_parameter_schema_ck
        CHECK (jsonb_typeof(parameter_schema) = 'object'),
    CONSTRAINT catalog_version_items_default_parameters_ck
        CHECK (jsonb_typeof(default_parameters) = 'object'),
    CONSTRAINT catalog_version_items_sort_order_ck CHECK (sort_order >= 0),
    CONSTRAINT catalog_version_items_version_model_uk
        UNIQUE (catalog_version_id, model_id),
    CONSTRAINT catalog_version_items_version_code_uk
        UNIQUE (catalog_version_id, provider_code, model_code)
);

CREATE INDEX catalog_version_items_order_idx
    ON model_catalog.catalog_version_items (
        catalog_version_id,
        capability_type,
        sort_order,
        display_name
    );

CREATE TABLE model_catalog.tenant_models (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL REFERENCES identity.tenants (id),
    model_id uuid NOT NULL REFERENCES model_catalog.models (id),
    policy varchar(16) NOT NULL DEFAULT 'inherit',
    updated_by_membership_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT tenant_models_operator_fk
        FOREIGN KEY (updated_by_membership_id, tenant_id)
        REFERENCES identity.tenant_memberships (id, tenant_id),
    CONSTRAINT tenant_models_policy_ck CHECK (policy IN ('inherit', 'enabled', 'hidden')),
    CONSTRAINT tenant_models_row_version_ck CHECK (row_version >= 0),
    CONSTRAINT tenant_models_tenant_model_uk UNIQUE (tenant_id, model_id)
);

CREATE INDEX tenant_models_tenant_policy_idx
    ON model_catalog.tenant_models (tenant_id, policy, updated_at DESC);

CREATE FUNCTION model_catalog.enforce_model_provider_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog
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

CREATE TRIGGER models_provider_state_trg
BEFORE INSERT OR UPDATE OF provider_id, status
ON model_catalog.models
FOR EACH ROW
EXECUTE FUNCTION model_catalog.enforce_model_provider_state();

CREATE FUNCTION model_catalog.protect_provider_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog
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

CREATE TRIGGER providers_active_models_trg
BEFORE UPDATE OF status
ON model_catalog.providers
FOR EACH ROW
EXECUTE FUNCTION model_catalog.protect_provider_state();

CREATE FUNCTION model_catalog.validate_catalog_publisher()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog, identity
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

CREATE TRIGGER catalog_versions_publisher_trg
BEFORE INSERT OR UPDATE OF published_by_user_id, published_by_membership_id
ON model_catalog.catalog_versions
FOR EACH ROW
EXECUTE FUNCTION model_catalog.validate_catalog_publisher();

CREATE FUNCTION model_catalog.enforce_catalog_version_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog
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

CREATE TRIGGER catalog_versions_lifecycle_trg
BEFORE UPDATE OR DELETE
ON model_catalog.catalog_versions
FOR EACH ROW
EXECUTE FUNCTION model_catalog.enforce_catalog_version_lifecycle();

CREATE FUNCTION model_catalog.enforce_catalog_version_item_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog
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

CREATE TRIGGER catalog_version_items_immutability_trg
BEFORE INSERT OR UPDATE OR DELETE
ON model_catalog.catalog_version_items
FOR EACH ROW
EXECUTE FUNCTION model_catalog.enforce_catalog_version_item_immutability();

CREATE FUNCTION model_catalog.validate_catalog_version_completion()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog
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

CREATE CONSTRAINT TRIGGER catalog_versions_completion_trg
AFTER INSERT OR UPDATE
ON model_catalog.catalog_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION model_catalog.validate_catalog_version_completion();

CREATE FUNCTION model_catalog.prevent_published_model_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, model_catalog
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

CREATE TRIGGER models_published_delete_trg
BEFORE DELETE
ON model_catalog.models
FOR EACH ROW
EXECUTE FUNCTION model_catalog.prevent_published_model_delete();

COMMENT ON SCHEMA model_catalog IS '平台模型目录、不可变发布快照和租户模型策略。';
COMMENT ON TABLE model_catalog.providers IS '模型厂商非敏感目录；不保存凭据、私有 Base URL 或 Header。';
COMMENT ON TABLE model_catalog.models IS '平台模型草稿目录；新增模型默认不向租户启用。';
COMMENT ON TABLE model_catalog.catalog_versions IS '目录发布版本；同事务写入快照后以 published_at 封存。';
COMMENT ON TABLE model_catalog.catalog_version_items IS '发布版本的不可变模型快照。';
COMMENT ON TABLE model_catalog.tenant_models IS '当前租户对稳定 model_id 的 inherit/enabled/hidden 策略。';

REVOKE ALL ON
    model_catalog.providers,
    model_catalog.models,
    model_catalog.catalog_versions,
    model_catalog.catalog_version_items,
    model_catalog.tenant_models
FROM PUBLIC, lingframe_app;

GRANT SELECT, INSERT, UPDATE ON
    model_catalog.providers,
    model_catalog.models,
    model_catalog.tenant_models
TO lingframe_app;

GRANT SELECT, INSERT ON model_catalog.catalog_versions TO lingframe_app;
GRANT UPDATE (is_current, published_at) ON model_catalog.catalog_versions TO lingframe_app;

GRANT SELECT, INSERT ON model_catalog.catalog_version_items TO lingframe_app;

REVOKE ALL ON FUNCTION
    model_catalog.enforce_model_provider_state(),
    model_catalog.protect_provider_state(),
    model_catalog.validate_catalog_publisher(),
    model_catalog.enforce_catalog_version_lifecycle(),
    model_catalog.enforce_catalog_version_item_immutability(),
    model_catalog.validate_catalog_version_completion(),
    model_catalog.prevent_published_model_delete()
FROM PUBLIC, lingframe_app;
