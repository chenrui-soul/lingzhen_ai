SET lock_timeout = '5s';
SET statement_timeout = '60s';

DO $$
BEGIN
    IF current_user <> 'lingframe_owner' THEN
        RAISE EXCEPTION 'platform task migrations must run as lingframe_owner';
    END IF;
    IF to_regclass('desktop_data.platform_model_tasks') IS NOT NULL THEN
        RAISE EXCEPTION 'desktop_data.platform_model_tasks already exists';
    END IF;
END
$$;

CREATE TABLE desktop_data.platform_model_tasks (
    id uuid PRIMARY KEY,
    tenant_id uuid NOT NULL,
    user_id uuid NOT NULL,
    model_id uuid NOT NULL REFERENCES model_catalog.models (id),
    provider_code varchar(96) NOT NULL,
    creation_type varchar(16) NOT NULL,
    client_request_id varchar(128) NOT NULL,
    provider_job_id varchar(200),
    state varchar(32) NOT NULL,
    result_urls jsonb NOT NULL DEFAULT '[]'::jsonb,
    result_text text NOT NULL DEFAULT '',
    error_code varchar(80) NOT NULL DEFAULT '',
    error_message varchar(500) NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT platform_model_tasks_membership_fk
        FOREIGN KEY (tenant_id, user_id)
        REFERENCES identity.tenant_memberships (tenant_id, user_id),
    CONSTRAINT platform_model_tasks_provider_ck CHECK (btrim(provider_code) <> ''),
    CONSTRAINT platform_model_tasks_type_ck CHECK (creation_type IN ('text', 'image', 'video', 'audio')),
    CONSTRAINT platform_model_tasks_request_ck CHECK (btrim(client_request_id) <> ''),
    CONSTRAINT platform_model_tasks_job_ck CHECK (provider_job_id IS NULL OR btrim(provider_job_id) <> ''),
    CONSTRAINT platform_model_tasks_state_ck CHECK (
        state IN ('submitting', 'pending', 'completed', 'failed', 'cancelled', 'submission_unknown')
    ),
    CONSTRAINT platform_model_tasks_urls_ck CHECK (
        jsonb_typeof(result_urls) = 'array' AND jsonb_array_length(result_urls) <= 20
    ),
    CONSTRAINT platform_model_tasks_version_ck CHECK (row_version >= 0),
    CONSTRAINT platform_model_tasks_owner_request_uk UNIQUE (tenant_id, user_id, client_request_id)
);

CREATE INDEX platform_model_tasks_owner_updated_idx
    ON desktop_data.platform_model_tasks (tenant_id, user_id, updated_at DESC, id DESC);

CREATE INDEX platform_model_tasks_recovery_idx
    ON desktop_data.platform_model_tasks (state, updated_at, id)
    WHERE state IN ('submitting', 'pending', 'submission_unknown');

COMMENT ON TABLE desktop_data.platform_model_tasks IS
    '平台模型服务端任务真相源；保存租户/用户归属、厂商任务标识和可恢复结果，不保存厂商密钥。';

REVOKE ALL ON desktop_data.platform_model_tasks FROM PUBLIC, lingframe_app;
GRANT SELECT, INSERT, UPDATE ON desktop_data.platform_model_tasks TO lingframe_app;
