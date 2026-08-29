package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ModelRuntimeConfigPersistenceAdapter implements ModelRuntimeConfigRepository {
    private static final String SELECT_COLUMNS = """
            SELECT c.model_id, c.base_url, c.api_key_ciphertext,
                   c.submit_path, c.status_path, c.cancel_path, c.timeout_seconds,
                   c.enabled, c.created_at, c.updated_at, c.row_version
            FROM model_catalog.model_runtime_configs c
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public ModelRuntimeConfigPersistenceAdapter(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @Override
    public Optional<RuntimeConfigRow> findByModelId(UUID modelId) {
        return jdbc.query(SELECT_COLUMNS + " WHERE c.model_id = :value",
                new MapSqlParameterSource("value", modelId), this::row).stream().findFirst();
    }

    @Override
    public RuntimeConfigRow upsert(UpsertCommand command) {
        Long expectedVersion = command.rowVersion() != null && findByModelId(command.modelId()).isPresent()
                ? command.rowVersion() : null;
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("modelId", command.modelId())
                .addValue("baseUrl", command.baseUrl())
                .addValue("apiKey", command.apiKeyCiphertext())
                .addValue("submitPath", command.submitPath())
                .addValue("statusPath", command.statusPath())
                .addValue("cancelPath", command.cancelPath())
                .addValue("timeoutSeconds", command.timeoutSeconds())
                .addValue("enabled", command.enabled())
                .addValue("rowVersion", expectedVersion);
        String sql = expectedVersion == null ? """
                INSERT INTO model_catalog.model_runtime_configs (
                    model_id, base_url, api_key_ciphertext, submit_path, status_path,
                    cancel_path, timeout_seconds, enabled
                ) VALUES (
                    :modelId, :baseUrl, :apiKey, :submitPath, :statusPath,
                    :cancelPath, :timeoutSeconds, :enabled
                )
                ON CONFLICT (model_id) DO NOTHING
                """ : """
                UPDATE model_catalog.model_runtime_configs
                SET base_url = :baseUrl,
                    api_key_ciphertext = :apiKey,
                    submit_path = :submitPath,
                    status_path = :statusPath,
                    cancel_path = :cancelPath,
                    timeout_seconds = :timeoutSeconds,
                    enabled = :enabled,
                    updated_at = now(),
                    row_version = row_version + 1
                WHERE model_id = :modelId AND row_version = :rowVersion
                """;
        if (jdbc.update(sql, parameters) != 1) {
            throw new IllegalStateException("MODEL_RUNTIME_CONFIG_CONFLICT");
        }
        return findByModelId(command.modelId()).orElseThrow();
    }

    private RuntimeConfigRow row(ResultSet resultSet, int ignored) throws SQLException {
        return new RuntimeConfigRow(
                resultSet.getObject("model_id", UUID.class), resultSet.getString("base_url"),
                resultSet.getString("api_key_ciphertext"), resultSet.getString("submit_path"),
                resultSet.getString("status_path"), resultSet.getString("cancel_path"),
                resultSet.getInt("timeout_seconds"), resultSet.getBoolean("enabled"),
                instant(resultSet, "created_at"), instant(resultSet, "updated_at"),
                resultSet.getLong("row_version"));
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
