package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

@Repository
public class PlatformModelTaskPersistenceAdapter implements PlatformModelTaskRepository {

    private static final String COLUMNS = """
            id, tenant_id, user_id, model_id, provider_code, creation_type,
            client_request_id, state, provider_job_id, result_urls::text,
            result_text, error_code, error_message, created_at, updated_at, row_version
            """;

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public PlatformModelTaskPersistenceAdapter(
            NamedParameterJdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public java.util.Optional<TaskRow> findOwned(UUID tenantId, UUID userId, UUID taskId) {
        return jdbcTemplate.query("""
                        SELECT %s
                        FROM desktop_data.platform_model_tasks
                        WHERE id = :taskId AND tenant_id = :tenantId AND user_id = :userId
                        """.formatted(COLUMNS),
                new MapSqlParameterSource()
                        .addValue("taskId", taskId)
                        .addValue("tenantId", tenantId)
                        .addValue("userId", userId),
                (resultSet, rowNumber) -> taskRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public java.util.Optional<TaskRow> findByClientRequestId(
            UUID tenantId,
            UUID userId,
            String clientRequestId
    ) {
        return jdbcTemplate.query("""
                        SELECT %s
                        FROM desktop_data.platform_model_tasks
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                          AND client_request_id = :clientRequestId
                        """.formatted(COLUMNS),
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("userId", userId)
                        .addValue("clientRequestId", clientRequestId),
                (resultSet, rowNumber) -> taskRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public List<TaskRow> findOwnedRecoverable(UUID tenantId, UUID userId, int limit) {
        int safeLimit = Math.max(1, Math.min(limit, 100));
        return jdbcTemplate.query("""
                        SELECT %s
                        FROM desktop_data.platform_model_tasks
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                          AND state IN ('submitting', 'pending', 'submission_unknown')
                        ORDER BY updated_at ASC, id ASC
                        LIMIT :limit
                        """.formatted(COLUMNS),
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("userId", userId)
                        .addValue("limit", safeLimit),
                (resultSet, rowNumber) -> taskRow(resultSet)
        );
    }

    @Override
    public java.util.Optional<TaskRow> create(CreateCommand command) {
        return jdbcTemplate.query("""
                        INSERT INTO desktop_data.platform_model_tasks (
                            id, tenant_id, user_id, model_id, provider_code,
                            creation_type, client_request_id, state
                        ) VALUES (
                            :id, :tenantId, :userId, :modelId, :providerCode,
                            :creationType, :clientRequestId, :state
                        )
                        ON CONFLICT (tenant_id, user_id, client_request_id) DO NOTHING
                        RETURNING %s
                        """.formatted(COLUMNS),
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("tenantId", command.tenantId())
                        .addValue("userId", command.userId())
                        .addValue("modelId", command.modelId())
                        .addValue("providerCode", command.providerCode())
                        .addValue("creationType", command.creationType())
                        .addValue("clientRequestId", command.clientRequestId())
                        .addValue("state", command.state()),
                (resultSet, rowNumber) -> taskRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public java.util.Optional<TaskRow> update(UpdateCommand command) {
        return jdbcTemplate.query("""
                        UPDATE desktop_data.platform_model_tasks
                        SET state = :state,
                            provider_job_id = :providerJobId,
                            result_urls = CAST(:resultUrls AS jsonb),
                            result_text = :resultText,
                            error_code = :errorCode,
                            error_message = :errorMessage,
                            updated_at = now(),
                            row_version = row_version + 1
                        WHERE id = :id
                          AND tenant_id = :tenantId
                          AND user_id = :userId
                          AND row_version = :rowVersion
                        RETURNING %s
                        """.formatted(COLUMNS),
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("tenantId", command.tenantId())
                        .addValue("userId", command.userId())
                        .addValue("state", command.state())
                        .addValue("providerJobId", blankToNull(command.providerJobId()))
                        .addValue("resultUrls", json(command.resultUrls()))
                        .addValue("resultText", command.resultText())
                        .addValue("errorCode", command.errorCode())
                        .addValue("errorMessage", command.errorMessage())
                        .addValue("rowVersion", command.rowVersion()),
                (resultSet, rowNumber) -> taskRow(resultSet)
        ).stream().findFirst();
    }

    private TaskRow taskRow(ResultSet resultSet) throws SQLException {
        return new TaskRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("tenant_id", UUID.class),
                resultSet.getObject("user_id", UUID.class),
                resultSet.getObject("model_id", UUID.class),
                resultSet.getString("provider_code"),
                resultSet.getString("creation_type"),
                resultSet.getString("client_request_id"),
                resultSet.getString("state"),
                resultSet.getString("provider_job_id"),
                stringList(resultSet.getString("result_urls")),
                resultSet.getString("result_text"),
                resultSet.getString("error_code"),
                resultSet.getString("error_message"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    @SuppressWarnings("unchecked")
    private List<String> stringList(String json) {
        try {
            List<Object> values = objectMapper.readValue(json, List.class);
            List<String> result = new ArrayList<>();
            for (Object value : values) {
                if (value != null) result.add(String.valueOf(value));
            }
            return List.copyOf(result);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored platform task result URLs are invalid", exception);
        }
    }

    private String json(List<String> values) {
        try {
            return objectMapper.writeValueAsString(values == null ? List.of() : values);
        } catch (JacksonException exception) {
            throw new IllegalArgumentException("Platform task result URLs are invalid", exception);
        }
    }

    private String blankToNull(String value) {
        return value == null || value.isBlank() ? null : value;
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
