package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class DesktopWorkspacePersistenceAdapter implements DesktopWorkspaceRepository {

    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public DesktopWorkspacePersistenceAdapter(
            NamedParameterJdbcTemplate jdbcTemplate,
            ObjectMapper objectMapper
    ) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<SnapshotRow> findSnapshot(UUID tenantId, UUID userId) {
        return jdbcTemplate.query("""
                        SELECT revision, snapshot::text, content_hash, updated_at
                        FROM desktop_data.workspace_snapshots
                        WHERE tenant_id = :tenantId AND user_id = :userId
                        """,
                owner(tenantId, userId),
                (resultSet, rowNumber) -> snapshotRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<SnapshotRow> saveSnapshot(
            UUID tenantId,
            UUID userId,
            long expectedRevision,
            Map<String, Object> snapshot,
            String contentHash
    ) {
        MapSqlParameterSource parameters = owner(tenantId, userId)
                .addValue("id", UUID.randomUUID())
                .addValue("expectedRevision", expectedRevision)
                .addValue("snapshot", writeJson(snapshot))
                .addValue("contentHash", contentHash);
        String sql = expectedRevision == 0 ? """
                INSERT INTO desktop_data.workspace_snapshots (
                    id, tenant_id, user_id, revision, snapshot, content_hash
                ) VALUES (
                    :id, :tenantId, :userId, 1, CAST(:snapshot AS jsonb), :contentHash
                )
                ON CONFLICT (tenant_id, user_id) DO NOTHING
                RETURNING revision, snapshot::text, content_hash, updated_at
                """ : """
                UPDATE desktop_data.workspace_snapshots
                SET revision = revision + 1,
                    snapshot = CAST(:snapshot AS jsonb),
                    content_hash = :contentHash,
                    updated_at = now()
                WHERE tenant_id = :tenantId
                  AND user_id = :userId
                  AND revision = :expectedRevision
                RETURNING revision, snapshot::text, content_hash, updated_at
                """;
        return jdbcTemplate.query(sql, parameters, (resultSet, rowNumber) -> snapshotRow(resultSet))
                .stream().findFirst();
    }

    @Override
    public List<DoubaoAccountRow> findDoubaoAccounts(UUID tenantId, UUID userId) {
        return jdbcTemplate.query("""
                        SELECT account_id, display_name, login_state, login_summary,
                               last_checked_at, updated_at, row_version
                        FROM desktop_data.doubao_account_bindings
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                          AND status = 'active'
                        ORDER BY updated_at DESC, account_id
                        LIMIT 50
                        """,
                owner(tenantId, userId),
                (resultSet, rowNumber) -> doubaoAccountRow(resultSet)
        );
    }

    @Override
    public DoubaoAccountRow upsertDoubaoAccount(
            UUID tenantId,
            UUID userId,
            String accountId,
            String displayName,
            String loginState,
            String loginSummary,
            Instant lastCheckedAt
    ) {
        MapSqlParameterSource parameters = owner(tenantId, userId)
                .addValue("id", UUID.randomUUID())
                .addValue("accountId", accountId)
                .addValue("displayName", displayName)
                .addValue("loginState", loginState)
                .addValue("loginSummary", loginSummary)
                .addValue("lastCheckedAt", lastCheckedAt == null ? null : OffsetDateTime.ofInstant(lastCheckedAt, ZoneOffset.UTC));
        return jdbcTemplate.query("""
                        INSERT INTO desktop_data.doubao_account_bindings (
                            id, tenant_id, user_id, account_id, display_name,
                            login_state, login_summary, last_checked_at, status
                        ) VALUES (
                            :id, :tenantId, :userId, :accountId, :displayName,
                            :loginState, :loginSummary, :lastCheckedAt, 'active'
                        )
                        ON CONFLICT (tenant_id, user_id, account_id) DO UPDATE
                        SET display_name = EXCLUDED.display_name,
                            login_state = EXCLUDED.login_state,
                            login_summary = EXCLUDED.login_summary,
                            last_checked_at = EXCLUDED.last_checked_at,
                            status = 'active',
                            updated_at = now(),
                            row_version = desktop_data.doubao_account_bindings.row_version + 1
                        RETURNING account_id, display_name, login_state, login_summary,
                                  last_checked_at, updated_at, row_version
                        """,
                parameters,
                (resultSet, rowNumber) -> doubaoAccountRow(resultSet)
        ).getFirst();
    }

    @Override
    public boolean removeDoubaoAccount(UUID tenantId, UUID userId, String accountId) {
        MapSqlParameterSource parameters = owner(tenantId, userId).addValue("accountId", accountId);
        return jdbcTemplate.update("""
                        UPDATE desktop_data.doubao_account_bindings
                        SET status = 'removed', updated_at = now(), row_version = row_version + 1
                        WHERE tenant_id = :tenantId
                          AND user_id = :userId
                          AND account_id = :accountId
                          AND status = 'active'
                        """, parameters) > 0;
    }

    @Override
    public List<SkillRow> findPublishedSkills(int limit) {
        return jdbcTemplate.query("""
                        SELECT skill_code, display_name, version, description
                        FROM desktop_data.published_skills
                        WHERE status = 'published'
                        ORDER BY published_at DESC, skill_code
                        LIMIT :limit
                        """,
                new MapSqlParameterSource("limit", limit),
                (resultSet, rowNumber) -> new SkillRow(
                        resultSet.getString("skill_code"),
                        resultSet.getString("display_name"),
                        resultSet.getString("version"),
                        resultSet.getString("description")
                )
        );
    }

    private MapSqlParameterSource owner(UUID tenantId, UUID userId) {
        return new MapSqlParameterSource().addValue("tenantId", tenantId).addValue("userId", userId);
    }

    private SnapshotRow snapshotRow(ResultSet resultSet) throws SQLException {
        return new SnapshotRow(
                resultSet.getLong("revision"),
                readJson(resultSet.getString("snapshot")),
                resultSet.getString("content_hash"),
                instant(resultSet, "updated_at")
        );
    }

    private DoubaoAccountRow doubaoAccountRow(ResultSet resultSet) throws SQLException {
        return new DoubaoAccountRow(
                resultSet.getString("account_id"),
                resultSet.getString("display_name"),
                resultSet.getString("login_state"),
                resultSet.getString("login_summary"),
                instant(resultSet, "last_checked_at"),
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> readJson(String value) {
        try {
            return objectMapper.readValue(value, Map.class);
        } catch (Exception exception) {
            return Collections.emptyMap();
        }
    }

    private String writeJson(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception exception) {
            throw new IllegalArgumentException("Desktop workspace snapshot cannot be serialized", exception);
        }
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
