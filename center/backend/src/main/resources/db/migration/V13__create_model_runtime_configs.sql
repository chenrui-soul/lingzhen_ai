CREATE TABLE model_catalog.model_runtime_configs (
    model_id uuid PRIMARY KEY REFERENCES model_catalog.models (id) ON DELETE CASCADE,
    base_url varchar(2048) NOT NULL,
    api_key_ciphertext text NOT NULL,
    submit_path varchar(512),
    status_path varchar(512),
    cancel_path varchar(512),
    timeout_seconds integer NOT NULL DEFAULT 120,
    enabled boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 0,
    CONSTRAINT model_runtime_base_url_ck CHECK (base_url ~ '^https?://'),
    CONSTRAINT model_runtime_timeout_ck CHECK (timeout_seconds BETWEEN 1 AND 600),
    CONSTRAINT model_runtime_row_version_ck CHECK (row_version >= 0)
);

INSERT INTO model_catalog.model_runtime_configs (
    model_id, base_url, api_key_ciphertext, submit_path, status_path, cancel_path,
    timeout_seconds, enabled, created_at, updated_at, row_version
)
SELECT m.id, c.base_url, c.api_key_ciphertext, c.submit_path, c.status_path, c.cancel_path,
       c.timeout_seconds, c.enabled, c.created_at, c.updated_at, c.row_version
FROM model_catalog.models m
JOIN model_catalog.provider_runtime_configs c ON c.provider_id = m.provider_id
ON CONFLICT (model_id) DO NOTHING;

REVOKE ALL ON model_catalog.model_runtime_configs FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE, DELETE ON model_catalog.model_runtime_configs TO lingframe_app;

COMMENT ON TABLE model_catalog.model_runtime_configs IS
    '管理员维护的模型级运行配置；API Key 使用应用层 AES-GCM 加密，不进入目录版本或桌面端响应。';
