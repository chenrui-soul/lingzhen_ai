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
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class TenantModelPersistenceAdapter implements TenantModelRepository {

    private static final int MAX_DESKTOP_MODELS = 500;

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public TenantModelPersistenceAdapter(
            NamedParameterJdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<TenantCatalog> findCurrentCatalog(
            UUID tenantId,
            boolean onlyEffectiveModels
    ) {
        MapSqlParameterSource parameters = new MapSqlParameterSource("tenantId", tenantId)
                .addValue("limit", MAX_DESKTOP_MODELS);
        List<CatalogHeader> headers = jdbcTemplate.query("""
                        SELECT version_no, published_at
                        FROM model_catalog.catalog_versions
                        WHERE is_current
                          AND published_at IS NOT NULL
                        """,
                parameters,
                (resultSet, rowNumber) -> new CatalogHeader(
                        resultSet.getLong("version_no"),
                        instant(resultSet, "published_at")
                )
        );
        if (headers.isEmpty()) {
            return Optional.empty();
        }

        String effectiveExpression = """
                CASE coalesce(policy.policy, 'inherit')
                    WHEN 'enabled' THEN true
                    WHEN 'hidden' THEN false
                    ELSE item.default_tenant_enabled
                END
                """.strip();
        String effectiveFilter = onlyEffectiveModels
                ? " AND (" + effectiveExpression + ") "
                : "";
        String sql = """
                        SELECT policy.id AS policy_id, item.model_id, item.provider_id,
                               item.provider_code, item.provider_display_name,
                               item.model_code, item.display_name, item.capability_type,
                               item.parameter_schema::text, item.default_parameters::text,
                               item.default_tenant_enabled,
                               coalesce(policy.policy, 'inherit') AS tenant_policy,
                               %s AS effective_enabled,
                               policy.row_version
                        FROM model_catalog.catalog_versions catalog_version
                        JOIN model_catalog.catalog_version_items item
                          ON item.catalog_version_id = catalog_version.id
                        LEFT JOIN model_catalog.tenant_models policy
                          ON policy.model_id = item.model_id
                         AND policy.tenant_id = :tenantId
                        WHERE catalog_version.is_current
                          AND catalog_version.published_at IS NOT NULL
                        %s
                         ORDER BY item.sort_order, item.display_name, item.model_id
                         LIMIT :limit
                        """.formatted(effectiveExpression, effectiveFilter);
        List<ModelRow> models = jdbcTemplate.query(
                sql,
                parameters,
                (resultSet, rowNumber) -> modelRow(resultSet)
        );
        CatalogHeader header = headers.getFirst();
        return Optional.of(new TenantCatalog(header.version(), header.publishedAt(), models));
    }

    @Override
    public Optional<Boolean> findCurrentModelDefault(UUID modelId) {
        return jdbcTemplate.query("""
                        SELECT item.default_tenant_enabled
                        FROM model_catalog.catalog_versions catalog_version
                        JOIN model_catalog.catalog_version_items item
                          ON item.catalog_version_id = catalog_version.id
                        WHERE catalog_version.is_current
                          AND catalog_version.published_at IS NOT NULL
                          AND item.model_id = :modelId
                        """,
                new MapSqlParameterSource("modelId", modelId),
                (resultSet, rowNumber) -> resultSet.getBoolean("default_tenant_enabled")
        ).stream().findFirst();
    }

    @Override
    public Optional<PolicyRow> findPolicy(UUID tenantId, UUID modelId) {
        return jdbcTemplate.query("""
                        SELECT id, tenant_id, model_id, policy, updated_by_membership_id,
                               created_at, updated_at, row_version
                        FROM model_catalog.tenant_models
                        WHERE tenant_id = :tenantId
                          AND model_id = :modelId
                        """,
                new MapSqlParameterSource()
                        .addValue("tenantId", tenantId)
                        .addValue("modelId", modelId),
                (resultSet, rowNumber) -> policyRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public PolicyRow createPolicy(PolicyCreateCommand command) {
        return jdbcTemplate.query("""
                        INSERT INTO model_catalog.tenant_models (
                            id, tenant_id, model_id, policy, updated_by_membership_id
                        ) VALUES (
                            :id, :tenantId, :modelId, :policy, :updatedByMembershipId
                        )
                        RETURNING id, tenant_id, model_id, policy,
                                  updated_by_membership_id, created_at, updated_at, row_version
                        """,
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("tenantId", command.tenantId())
                        .addValue("modelId", command.modelId())
                        .addValue("policy", command.policy())
                        .addValue("updatedByMembershipId", command.updatedByMembershipId()),
                (resultSet, rowNumber) -> policyRow(resultSet)
        ).stream().findFirst().orElseThrow(() ->
                new IllegalStateException("Tenant model policy was not created")
        );
    }

    @Override
    public Optional<PolicyRow> updatePolicy(PolicyUpdateCommand command) {
        return jdbcTemplate.query("""
                        UPDATE model_catalog.tenant_models
                        SET policy = :policy,
                            updated_by_membership_id = :updatedByMembershipId,
                            updated_at = now(),
                            row_version = row_version + 1
                        WHERE id = :id
                          AND tenant_id = :tenantId
                          AND model_id = :modelId
                          AND row_version = :rowVersion
                        RETURNING id, tenant_id, model_id, policy,
                                  updated_by_membership_id, created_at, updated_at, row_version
                        """,
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("tenantId", command.tenantId())
                        .addValue("modelId", command.modelId())
                        .addValue("policy", command.policy())
                        .addValue("updatedByMembershipId", command.updatedByMembershipId())
                        .addValue("rowVersion", command.rowVersion()),
                (resultSet, rowNumber) -> policyRow(resultSet)
        ).stream().findFirst();
    }

    private ModelRow modelRow(ResultSet resultSet) throws SQLException {
        long rowVersionValue = resultSet.getLong("row_version");
        Long rowVersion = resultSet.wasNull() ? null : rowVersionValue;
        return new ModelRow(
                uuidOrNull(resultSet, "policy_id"),
                uuid(resultSet, "model_id"),
                uuid(resultSet, "provider_id"),
                resultSet.getString("provider_code"),
                resultSet.getString("provider_display_name"),
                resultSet.getString("model_code"),
                resultSet.getString("display_name"),
                resultSet.getString("capability_type"),
                jsonObject(resultSet.getString("parameter_schema")),
                jsonObject(resultSet.getString("default_parameters")),
                resultSet.getBoolean("default_tenant_enabled"),
                resultSet.getString("tenant_policy"),
                resultSet.getBoolean("effective_enabled"),
                rowVersion
        );
    }

    private PolicyRow policyRow(ResultSet resultSet) throws SQLException {
        return new PolicyRow(
                uuid(resultSet, "id"),
                uuid(resultSet, "tenant_id"),
                uuid(resultSet, "model_id"),
                resultSet.getString("policy"),
                uuid(resultSet, "updated_by_membership_id"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> jsonObject(String json) {
        try {
            Map<String, Object> value = objectMapper.readValue(json, Map.class);
            return Collections.unmodifiableMap(new LinkedHashMap<>(value));
        } catch (JacksonException exception) {
            throw new IllegalStateException("Stored model catalog JSON is invalid", exception);
        }
    }

    private UUID uuid(ResultSet resultSet, String column) throws SQLException {
        return resultSet.getObject(column, UUID.class);
    }

    private UUID uuidOrNull(ResultSet resultSet, String column) throws SQLException {
        return resultSet.getObject(column, UUID.class);
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private record CatalogHeader(long version, Instant publishedAt) {
    }
}
