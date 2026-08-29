\set ON_ERROR_STOP on

BEGIN;

REVOKE ALL ON DATABASE lingframe_identity FROM PUBLIC;
GRANT CONNECT ON DATABASE lingframe_identity TO lingframe_owner;
GRANT CONNECT ON DATABASE lingframe_identity TO lingframe_app;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE SCHEMA IF NOT EXISTS identity AUTHORIZATION lingframe_owner;
CREATE SCHEMA IF NOT EXISTS workspace AUTHORIZATION lingframe_owner;
CREATE SCHEMA IF NOT EXISTS sync AUTHORIZATION lingframe_owner;
CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION lingframe_owner;

REVOKE ALL ON SCHEMA identity, workspace, sync, audit FROM PUBLIC;
GRANT USAGE ON SCHEMA identity, workspace, sync, audit TO lingframe_app;

CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version bigint PRIMARY KEY,
  description text NOT NULL,
  checksum text NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.service_metadata (
  metadata_key text PRIMARY KEY,
  metadata_value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON public.schema_migrations, public.service_metadata FROM PUBLIC;
GRANT SELECT ON public.schema_migrations, public.service_metadata TO lingframe_app;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA identity, workspace, sync, audit
  TO lingframe_app;
GRANT USAGE, SELECT, UPDATE
  ON ALL SEQUENCES IN SCHEMA identity, workspace, sync, audit
  TO lingframe_app;

ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA identity
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lingframe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA workspace
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lingframe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA sync
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lingframe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA audit
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lingframe_app;

ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA identity
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lingframe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA workspace
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lingframe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA sync
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lingframe_app;
ALTER DEFAULT PRIVILEGES FOR ROLE lingframe_owner IN SCHEMA audit
  GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO lingframe_app;

INSERT INTO public.schema_migrations (version, description, checksum)
VALUES (1, 'bootstrap identity database', 'lingframe-bootstrap-v1')
ON CONFLICT (version) DO NOTHING;

INSERT INTO public.service_metadata (metadata_key, metadata_value)
VALUES
  ('database_name', '"lingframe_identity"'::jsonb),
  ('host_port', '5433'::jsonb),
  ('bootstrap_version', '1'::jsonb),
  ('legacy_json_migrated', 'false'::jsonb)
ON CONFLICT (metadata_key) DO UPDATE
SET metadata_value = EXCLUDED.metadata_value,
    updated_at = now();

COMMIT;
