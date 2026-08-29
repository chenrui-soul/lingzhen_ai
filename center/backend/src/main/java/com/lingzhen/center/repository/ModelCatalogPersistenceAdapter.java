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
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ModelCatalogPersistenceAdapter implements ModelCatalogRepository {

    private static final long PUBLICATION_LOCK_KEY = 5494391542026572101L;

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ModelCatalogPersistenceAdapter(
            NamedParameterJdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public ProviderPage findProviders(int offset, int limit) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("offset", offset)
                .addValue("limit", limit);
        long total = requiredLong(jdbcTemplate.queryForObject(
                "SELECT count(*) FROM model_catalog.providers",
                parameters,
                Long.class
        ));
        List<ProviderRow> items = jdbcTemplate.query("""
                        SELECT id, provider_code, display_name, protocol_family,
                               description, status, created_at, updated_at, row_version
                        FROM model_catalog.providers
                        ORDER BY CASE status WHEN 'active' THEN 0 WHEN 'draft' THEN 1 ELSE 2 END,
                                 display_name,
                                 id
                        LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> new ProviderRow(
                        uuid(resultSet, "id"),
                        resultSet.getString("provider_code"),
                        resultSet.getString("display_name"),
                        resultSet.getString("protocol_family"),
                        resultSet.getString("description"),
                        resultSet.getString("status"),
                        instant(resultSet, "created_at"),
                        instant(resultSet, "updated_at"),
                        resultSet.getLong("row_version")
                )
        );
        return new ProviderPage(items, total);
    }

    @Override
    public Optional<ProviderRow> findProvider(UUID providerId) {
        return jdbcTemplate.query("""
                        SELECT id, provider_code, display_name, protocol_family,
                               description, status, created_at, updated_at, row_version
                        FROM model_catalog.providers
                        WHERE id = :providerId
                        """,
                new MapSqlParameterSource("providerId", providerId),
                (resultSet, rowNumber) -> providerRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<ProviderRow> createProvider(ProviderCreateCommand command) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("id", command.id())
                .addValue("code", command.code())
                .addValue("displayName", command.displayName())
                .addValue("protocolFamily", command.protocolFamily())
                .addValue("description", command.description());
        return jdbcTemplate.query("""
                        INSERT INTO model_catalog.providers (
                            id, provider_code, display_name, protocol_family, description, status
                        ) VALUES (
                            :id, :code, :displayName, :protocolFamily, :description, 'draft'
                        )
                        ON CONFLICT (provider_code) DO NOTHING
                        RETURNING id, provider_code, display_name, protocol_family,
                                  description, status, created_at, updated_at, row_version
                        """,
                parameters,
                (resultSet, rowNumber) -> providerRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<ProviderRow> updateProvider(ProviderUpdateCommand command) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("id", command.id())
                .addValue("displayName", command.displayName())
                .addValue("protocolFamily", command.protocolFamily())
                .addValue("description", command.description())
                .addValue("status", command.status())
                .addValue("rowVersion", command.rowVersion());
        return jdbcTemplate.query("""
                        UPDATE model_catalog.providers
                        SET display_name = :displayName,
                            protocol_family = :protocolFamily,
                            description = :description,
                            status = :status,
                            updated_at = now(),
                            row_version = row_version + 1
                        WHERE id = :id
                          AND row_version = :rowVersion
                        RETURNING id, provider_code, display_name, protocol_family,
                                  description, status, created_at, updated_at, row_version
                        """,
                parameters,
                (resultSet, rowNumber) -> providerRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public boolean providerHasActiveModels(UUID providerId) {
        Boolean result = jdbcTemplate.queryForObject("""
                        SELECT EXISTS (
                            SELECT 1
                            FROM model_catalog.models
                            WHERE provider_id = :providerId
                              AND status = 'active'
                        )
                        """,
                new MapSqlParameterSource("providerId", providerId),
                Boolean.class
        );
        return Boolean.TRUE.equals(result);
    }

    @Override
    public ModelPage findModels(
            String keyword,
            String status,
            String capabilityType,
            UUID providerId,
            int offset,
            int limit
    ) {
        StringBuilder where = new StringBuilder(" WHERE 1 = 1 ");
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("offset", offset)
                .addValue("limit", limit);
        if (keyword != null) {
            where.append(" AND (lower(m.display_name) LIKE :keyword ESCAPE '\\' ")
                    .append("OR lower(m.model_code) LIKE :keyword ESCAPE '\\') ");
            parameters.addValue("keyword", '%' + escapeLike(keyword.toLowerCase(Locale.ROOT)) + '%');
        }
        if (status != null) {
            where.append(" AND m.status = :status ");
            parameters.addValue("status", status);
        }
        if (capabilityType != null) {
            where.append(" AND m.capability_type = :capabilityType ");
            parameters.addValue("capabilityType", capabilityType);
        }
        if (providerId != null) {
            where.append(" AND m.provider_id = :providerId ");
            parameters.addValue("providerId", providerId);
        }

        long total = requiredLong(jdbcTemplate.queryForObject("""
                        SELECT count(*)
                        FROM model_catalog.models m
                        """ + where,
                parameters,
                Long.class
        ));
        List<ModelRow> items = jdbcTemplate.query("""
                        SELECT m.id, m.provider_id, p.provider_code, p.display_name AS provider_name,
                               m.model_code, m.display_name, m.capability_type, m.description,
                               m.parameter_schema::text, m.default_parameters::text,
                               m.default_tenant_enabled, m.sort_order, m.status,
                               m.created_at, m.updated_at, m.row_version
                        FROM model_catalog.models m
                        JOIN model_catalog.providers p ON p.id = m.provider_id
                        """ + where + """
                         ORDER BY m.sort_order, m.display_name, m.id
                         LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> modelRow(resultSet)
        );
        return new ModelPage(items, total);
    }

    @Override
    public Optional<ModelRow> findModel(UUID modelId) {
        return jdbcTemplate.query("""
                        SELECT m.id, m.provider_id, p.provider_code, p.display_name AS provider_name,
                               m.model_code, m.display_name, m.capability_type, m.description,
                               m.parameter_schema::text, m.default_parameters::text,
                               m.default_tenant_enabled, m.sort_order, m.status,
                               m.created_at, m.updated_at, m.row_version
                        FROM model_catalog.models m
                        JOIN model_catalog.providers p ON p.id = m.provider_id
                        WHERE m.id = :modelId
                        """,
                new MapSqlParameterSource("modelId", modelId),
                (resultSet, rowNumber) -> modelRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<ModelRow> createModel(ModelCreateCommand command) {
        MapSqlParameterSource parameters = modelParameters(command.id(), command.providerId(),
                command.code(), command.displayName(), command.capabilityType(),
                command.description(), command.parameterSchema(), command.defaultParameters(),
                command.defaultTenantEnabled(), command.sortOrder())
                .addValue("status", command.status());
        return jdbcTemplate.query("""
                        WITH inserted AS (
                            INSERT INTO model_catalog.models (
                                id, provider_id, model_code, display_name, capability_type,
                                description, parameter_schema, default_parameters,
                                default_tenant_enabled, sort_order, status
                            ) VALUES (
                                :id, :providerId, :code, :displayName, :capabilityType,
                                :description, CAST(:parameterSchema AS jsonb),
                                CAST(:defaultParameters AS jsonb), :defaultTenantEnabled,
                                :sortOrder, :status
                            )
                            ON CONFLICT (provider_id, model_code) DO NOTHING
                            RETURNING *
                        )
                        SELECT i.id, i.provider_id, p.provider_code,
                               p.display_name AS provider_name, i.model_code,
                               i.display_name, i.capability_type, i.description,
                               i.parameter_schema::text, i.default_parameters::text,
                               i.default_tenant_enabled, i.sort_order, i.status,
                               i.created_at, i.updated_at, i.row_version
                        FROM inserted i
                        JOIN model_catalog.providers p ON p.id = i.provider_id
                        """,
                parameters,
                (resultSet, rowNumber) -> modelRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<ModelRow> updateModel(ModelUpdateCommand command) {
        MapSqlParameterSource parameters = modelParameters(command.id(), command.providerId(),
                command.code(), command.displayName(), command.capabilityType(),
                command.description(), command.parameterSchema(), command.defaultParameters(),
                command.defaultTenantEnabled(), command.sortOrder())
                .addValue("status", command.status())
                .addValue("rowVersion", command.rowVersion());
        return jdbcTemplate.query("""
                        WITH updated AS (
                            UPDATE model_catalog.models
                            SET provider_id = :providerId,
                                model_code = :code,
                                display_name = :displayName,
                                capability_type = :capabilityType,
                                description = :description,
                                parameter_schema = CAST(:parameterSchema AS jsonb),
                                default_parameters = CAST(:defaultParameters AS jsonb),
                                default_tenant_enabled = :defaultTenantEnabled,
                                sort_order = :sortOrder,
                                status = :status,
                                updated_at = now(),
                                row_version = row_version + 1
                            WHERE id = :id
                              AND row_version = :rowVersion
                            RETURNING *
                        )
                        SELECT u.id, u.provider_id, p.provider_code,
                               p.display_name AS provider_name, u.model_code,
                               u.display_name, u.capability_type, u.description,
                               u.parameter_schema::text, u.default_parameters::text,
                               u.default_tenant_enabled, u.sort_order, u.status,
                               u.created_at, u.updated_at, u.row_version
                        FROM updated u
                        JOIN model_catalog.providers p ON p.id = u.provider_id
                        """,
                parameters,
                (resultSet, rowNumber) -> modelRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public VersionPage findVersions(int offset, int limit) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("offset", offset)
                .addValue("limit", limit);
        long total = requiredLong(jdbcTemplate.queryForObject("""
                        SELECT count(*)
                        FROM model_catalog.catalog_versions
                        WHERE published_at IS NOT NULL
                        """,
                parameters,
                Long.class
        ));
        List<VersionRow> items = jdbcTemplate.query("""
                        SELECT v.id, v.version_no, v.is_current, v.content_hash,
                               v.published_by_user_id, v.published_by_membership_id,
                               v.published_at, v.created_at,
                               (SELECT count(*)
                                FROM model_catalog.catalog_version_items item
                                WHERE item.catalog_version_id = v.id) AS model_count
                        FROM model_catalog.catalog_versions v
                        WHERE v.published_at IS NOT NULL
                        ORDER BY v.version_no DESC
                        LIMIT :limit OFFSET :offset
                        """,
                parameters,
                (resultSet, rowNumber) -> versionRow(resultSet)
        );
        return new VersionPage(items, total);
    }

    @Override
    public Optional<VersionDetail> findVersion(UUID versionId) {
        MapSqlParameterSource parameters = new MapSqlParameterSource("versionId", versionId);
        List<VersionRow> versions = jdbcTemplate.query("""
                        SELECT v.id, v.version_no, v.is_current, v.content_hash,
                               v.published_by_user_id, v.published_by_membership_id,
                               v.published_at, v.created_at,
                               (SELECT count(*)
                                FROM model_catalog.catalog_version_items item
                                WHERE item.catalog_version_id = v.id) AS model_count
                        FROM model_catalog.catalog_versions v
                        WHERE v.id = :versionId
                          AND v.published_at IS NOT NULL
                        """,
                parameters,
                (resultSet, rowNumber) -> versionRow(resultSet)
        );
        if (versions.isEmpty()) {
            return Optional.empty();
        }

        List<VersionModelRow> models = jdbcTemplate.query("""
                        SELECT model_id, provider_id, provider_code, provider_display_name,
                               provider_protocol_family, model_code, display_name,
                               capability_type, description, parameter_schema::text,
                               default_parameters::text, default_tenant_enabled, sort_order
                        FROM model_catalog.catalog_version_items
                        WHERE catalog_version_id = :versionId
                        ORDER BY sort_order, display_name, model_id
                        """,
                parameters,
                (resultSet, rowNumber) -> versionModelRow(resultSet)
        );
        return Optional.of(new VersionDetail(versions.getFirst(), models));
    }

    @Override
    public Optional<VersionDetail> findCurrentVersion() {
        return findPublishedVersionId("WHERE is_current AND published_at IS NOT NULL", null)
                .flatMap(this::findVersion);
    }

    @Override
    public Optional<VersionDetail> findVersionByIdempotencyKey(String idempotencyKey) {
        return findPublishedVersionId(
                "WHERE idempotency_key = :idempotencyKey AND published_at IS NOT NULL",
                new MapSqlParameterSource("idempotencyKey", idempotencyKey)
        ).flatMap(this::findVersion);
    }

    @Override
    public List<VersionModelRow> findPublishableModels() {
        return jdbcTemplate.query("""
                        SELECT m.id AS model_id, p.id AS provider_id,
                               p.provider_code, p.display_name AS provider_display_name,
                               p.protocol_family AS provider_protocol_family,
                               m.model_code, m.display_name, m.capability_type, m.description,
                               m.parameter_schema::text, m.default_parameters::text,
                               m.default_tenant_enabled, m.sort_order
                        FROM model_catalog.models m
                        JOIN model_catalog.providers p ON p.id = m.provider_id
                        WHERE m.status = 'active'
                          AND p.status = 'active'
                        ORDER BY m.sort_order, m.display_name, m.id
                        """,
                new MapSqlParameterSource(),
                (resultSet, rowNumber) -> versionModelRow(resultSet)
        );
    }

    @Override
    public void acquirePublicationLock() {
        jdbcTemplate.query(
                "SELECT pg_advisory_xact_lock(:lockKey)",
                new MapSqlParameterSource("lockKey", PUBLICATION_LOCK_KEY),
                resultSet -> null
        );
    }

    @Override
    public long nextVersionNumber() {
        return requiredLong(jdbcTemplate.queryForObject("""
                        SELECT coalesce(max(version_no), 0) + 1
                        FROM model_catalog.catalog_versions
                        """,
                new MapSqlParameterSource(),
                Long.class
        ));
    }

    @Override
    public void createVersionHeader(VersionCreateCommand command) {
        int inserted = jdbcTemplate.update("""
                        INSERT INTO model_catalog.catalog_versions (
                            id, version_no, content_hash, idempotency_key,
                            published_by_user_id, published_by_membership_id
                        ) VALUES (
                            :id, :version, :contentHash, :idempotencyKey,
                            :publishedByUserId, :publishedByMembershipId
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("version", command.version())
                        .addValue("contentHash", command.contentHash())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("publishedByUserId", command.publishedByUserId())
                        .addValue("publishedByMembershipId", command.publishedByMembershipId())
        );
        if (inserted != 1) {
            throw new IllegalStateException("Catalog version header was not created");
        }
    }

    @Override
    public void insertVersionItems(UUID versionId, List<VersionModelRow> models) {
        List<MapSqlParameterSource> batch = new ArrayList<>(models.size());
        for (VersionModelRow model : models) {
            batch.add(new MapSqlParameterSource()
                    .addValue("id", UUID.randomUUID())
                    .addValue("versionId", versionId)
                    .addValue("modelId", model.modelId())
                    .addValue("providerId", model.providerId())
                    .addValue("providerCode", model.providerCode())
                    .addValue("providerDisplayName", model.providerDisplayName())
                    .addValue("providerProtocolFamily", model.providerProtocolFamily())
                    .addValue("modelCode", model.code())
                    .addValue("displayName", model.displayName())
                    .addValue("capabilityType", model.capabilityType())
                    .addValue("description", model.description())
                    .addValue("parameterSchema", json(model.parameterSchema()))
                    .addValue("defaultParameters", json(model.defaultParameters()))
                    .addValue("defaultTenantEnabled", model.defaultTenantEnabled())
                    .addValue("sortOrder", model.sortOrder()));
        }
        jdbcTemplate.batchUpdate("""
                        INSERT INTO model_catalog.catalog_version_items (
                            id, catalog_version_id, model_id, provider_id,
                            provider_code, provider_display_name, provider_protocol_family,
                            model_code, display_name, capability_type, description,
                            parameter_schema, default_parameters, default_tenant_enabled,
                            sort_order
                        ) VALUES (
                            :id, :versionId, :modelId, :providerId,
                            :providerCode, :providerDisplayName, :providerProtocolFamily,
                            :modelCode, :displayName, :capabilityType, :description,
                            CAST(:parameterSchema AS jsonb), CAST(:defaultParameters AS jsonb),
                            :defaultTenantEnabled, :sortOrder
                        )
                        """,
                batch.toArray(MapSqlParameterSource[]::new)
        );
    }

    @Override
    public void sealVersion(UUID versionId, Instant publishedAt) {
        int updated = jdbcTemplate.update("""
                        UPDATE model_catalog.catalog_versions
                        SET published_at = :publishedAt
                        WHERE id = :versionId
                          AND published_at IS NULL
                          AND NOT is_current
                        """,
                new MapSqlParameterSource()
                        .addValue("versionId", versionId)
                        .addValue("publishedAt", OffsetDateTime.ofInstant(
                                publishedAt,
                                ZoneOffset.UTC
                        ))
        );
        if (updated != 1) {
            throw new IllegalStateException("Catalog version could not be sealed");
        }
    }

    @Override
    public void replaceCurrentVersion(UUID versionId) {
        jdbcTemplate.update("""
                        UPDATE model_catalog.catalog_versions
                        SET is_current = false
                        WHERE is_current
                        """,
                new MapSqlParameterSource()
        );
        int updated = jdbcTemplate.update("""
                        UPDATE model_catalog.catalog_versions
                        SET is_current = true
                        WHERE id = :versionId
                          AND published_at IS NOT NULL
                          AND NOT is_current
                        """,
                new MapSqlParameterSource("versionId", versionId)
        );
        if (updated != 1) {
            throw new IllegalStateException("Catalog version could not become current");
        }
    }

    private Optional<UUID> findPublishedVersionId(
            String whereClause,
            MapSqlParameterSource parameters
    ) {
        MapSqlParameterSource actualParameters = parameters == null
                ? new MapSqlParameterSource()
                : parameters;
        return jdbcTemplate.query(
                "SELECT id FROM model_catalog.catalog_versions " + whereClause,
                actualParameters,
                (resultSet, rowNumber) -> uuid(resultSet, "id")
        ).stream().findFirst();
    }

    private VersionModelRow versionModelRow(ResultSet resultSet) throws SQLException {
        return new VersionModelRow(
                uuid(resultSet, "model_id"),
                uuid(resultSet, "provider_id"),
                resultSet.getString("provider_code"),
                resultSet.getString("provider_display_name"),
                resultSet.getString("provider_protocol_family"),
                resultSet.getString("model_code"),
                resultSet.getString("display_name"),
                resultSet.getString("capability_type"),
                resultSet.getString("description"),
                jsonObject(resultSet.getString("parameter_schema")),
                jsonObject(resultSet.getString("default_parameters")),
                resultSet.getBoolean("default_tenant_enabled"),
                resultSet.getInt("sort_order")
        );
    }

    private ModelRow modelRow(ResultSet resultSet) throws SQLException {
        return new ModelRow(
                uuid(resultSet, "id"),
                uuid(resultSet, "provider_id"),
                resultSet.getString("provider_code"),
                resultSet.getString("provider_name"),
                resultSet.getString("model_code"),
                resultSet.getString("display_name"),
                resultSet.getString("capability_type"),
                resultSet.getString("description"),
                jsonObject(resultSet.getString("parameter_schema")),
                jsonObject(resultSet.getString("default_parameters")),
                resultSet.getBoolean("default_tenant_enabled"),
                resultSet.getInt("sort_order"),
                resultSet.getString("status"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    private ProviderRow providerRow(ResultSet resultSet) throws SQLException {
        return new ProviderRow(
                uuid(resultSet, "id"),
                resultSet.getString("provider_code"),
                resultSet.getString("display_name"),
                resultSet.getString("protocol_family"),
                resultSet.getString("description"),
                resultSet.getString("status"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    private MapSqlParameterSource modelParameters(
            UUID id,
            UUID providerId,
            String code,
            String displayName,
            String capabilityType,
            String description,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder
    ) {
        return new MapSqlParameterSource()
                .addValue("id", id)
                .addValue("providerId", providerId)
                .addValue("code", code)
                .addValue("displayName", displayName)
                .addValue("capabilityType", capabilityType)
                .addValue("description", description)
                .addValue("parameterSchema", json(parameterSchema))
                .addValue("defaultParameters", json(defaultParameters))
                .addValue("defaultTenantEnabled", defaultTenantEnabled)
                .addValue("sortOrder", sortOrder);
    }

    private VersionRow versionRow(ResultSet resultSet) throws SQLException {
        return new VersionRow(
                uuid(resultSet, "id"),
                resultSet.getLong("version_no"),
                resultSet.getBoolean("is_current"),
                resultSet.getString("content_hash"),
                uuid(resultSet, "published_by_user_id"),
                uuid(resultSet, "published_by_membership_id"),
                instant(resultSet, "published_at"),
                instant(resultSet, "created_at"),
                resultSet.getLong("model_count")
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

    private String json(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (JacksonException exception) {
            throw new IllegalStateException("Validated model catalog JSON could not be serialized", exception);
        }
    }

    private UUID uuid(ResultSet resultSet, String column) throws SQLException {
        return resultSet.getObject(column, UUID.class);
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private long requiredLong(Long value) {
        if (value == null) {
            throw new IllegalStateException("Database count query returned null");
        }
        return value;
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }
}
