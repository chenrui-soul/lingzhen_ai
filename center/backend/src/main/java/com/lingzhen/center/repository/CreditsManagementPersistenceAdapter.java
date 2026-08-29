package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Repository
public class CreditsManagementPersistenceAdapter implements CreditsManagementRepository {

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public CreditsManagementPersistenceAdapter(NamedParameterJdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public List<WalletRow> findWallets(
            String keyword,
            String status,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    ) {
        MapSqlParameterSource parameters = commonParameters(keyword, status, beforeCreatedAt, beforeId, limit);
        String filters = userFilters(keyword, status, "u") + cursorClause(beforeCreatedAt, beforeId, "w.updated_at", "w.user_id");
        return jdbcTemplate.query("""
                        SELECT w.user_id, u.username, u.email, u.status AS user_status,
                               w.available_balance, w.reserved_balance, w.created_at, w.updated_at
                        FROM billing.user_wallets w
                        JOIN identity.users u ON u.id = w.user_id
                        WHERE 1 = 1
                        %s
                        ORDER BY w.updated_at DESC, w.user_id DESC
                        LIMIT :limit
                        """.formatted(filters),
                parameters,
                (resultSet, rowNumber) -> new WalletRow(
                        uuid(resultSet, "user_id"),
                        resultSet.getString("username"),
                        resultSet.getString("email"),
                        resultSet.getString("user_status"),
                        resultSet.getLong("available_balance"),
                        resultSet.getLong("reserved_balance"),
                        instant(resultSet, "created_at"),
                        instant(resultSet, "updated_at")
                ));
    }

    @Override
    public List<OrderRow> findOrders(
            String keyword,
            String status,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    ) {
        MapSqlParameterSource parameters = commonParameters(keyword, status, beforeCreatedAt, beforeId, limit);
        StringBuilder filters = new StringBuilder();
        if (status != null) {
            filters.append(" AND o.status = :status");
        }
        if (keyword != null) {
            filters.append("""
                     AND (
                         lower(o.order_no) LIKE :keyword ESCAPE '\\'
                         OR lower(coalesce(u.username, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(coalesce(u.email, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(o.user_id::text) LIKE :keyword ESCAPE '\\'
                     )
                    """);
        }
        filters.append(cursorClause(beforeCreatedAt, beforeId, "o.created_at", "o.id"));
        return jdbcTemplate.query("""
                        SELECT o.id, o.order_no, o.user_id, u.username, u.email,
                               o.package_code_snapshot, o.cash_amount_cents, o.credit_amount,
                               o.bonus_credits, o.payment_channel, o.status, o.expires_at,
                               o.paid_at, o.closed_at, o.submission_note, o.review_reason,
                               o.reviewed_at, o.created_at, o.updated_at
                        FROM billing.recharge_orders o
                        JOIN identity.users u ON u.id = o.user_id
                        WHERE 1 = 1
                        %s
                        ORDER BY o.created_at DESC, o.id DESC
                        LIMIT :limit
                        """.formatted(filters),
                parameters,
                (resultSet, rowNumber) -> new OrderRow(
                        uuid(resultSet, "id"),
                        resultSet.getString("order_no"),
                        uuid(resultSet, "user_id"),
                        resultSet.getString("username"),
                        resultSet.getString("email"),
                        resultSet.getString("package_code_snapshot"),
                        resultSet.getLong("cash_amount_cents"),
                        resultSet.getLong("credit_amount"),
                        resultSet.getLong("bonus_credits"),
                        resultSet.getString("payment_channel"),
                        resultSet.getString("status"),
                        instant(resultSet, "expires_at"),
                        instant(resultSet, "paid_at"),
                        instant(resultSet, "closed_at"),
                        resultSet.getString("submission_note"),
                        resultSet.getString("review_reason"),
                        instant(resultSet, "reviewed_at"),
                        instant(resultSet, "created_at"),
                        instant(resultSet, "updated_at")
                ));
    }

    @Override
    public List<LedgerRow> findLedger(
            String keyword,
            String entryType,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    ) {
        MapSqlParameterSource parameters = commonParameters(keyword, entryType, beforeCreatedAt, beforeId, limit);
        StringBuilder filters = new StringBuilder();
        if (entryType != null) {
            filters.append(" AND e.entry_type = :status");
        }
        if (keyword != null) {
            filters.append("""
                     AND (
                         lower(coalesce(u.username, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(coalesce(u.email, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(e.user_id::text) LIKE :keyword ESCAPE '\\'
                         OR lower(e.business_type) LIKE :keyword ESCAPE '\\'
                         OR lower(e.business_id) LIKE :keyword ESCAPE '\\'
                     )
                    """);
        }
        filters.append(cursorClause(beforeCreatedAt, beforeId, "e.created_at", "e.id"));
        return jdbcTemplate.query("""
                        SELECT e.id, e.user_id, u.username, u.email, e.tenant_id,
                               t.display_name AS tenant_name, e.entry_type,
                               e.available_delta, e.reserved_delta, e.available_after,
                               e.reserved_after, e.business_type, e.business_id, e.reason,
                               e.created_at
                        FROM billing.credit_ledger_entries e
                        JOIN identity.users u ON u.id = e.user_id
                        LEFT JOIN identity.tenants t ON t.id = e.tenant_id
                        WHERE 1 = 1
                        %s
                        ORDER BY e.created_at DESC, e.id DESC
                        LIMIT :limit
                        """.formatted(filters),
                parameters,
                (resultSet, rowNumber) -> new LedgerRow(
                        uuid(resultSet, "id"),
                        uuid(resultSet, "user_id"),
                        resultSet.getString("username"),
                        resultSet.getString("email"),
                        nullableUuid(resultSet, "tenant_id"),
                        resultSet.getString("tenant_name"),
                        resultSet.getString("entry_type"),
                        resultSet.getLong("available_delta"),
                        resultSet.getLong("reserved_delta"),
                        resultSet.getLong("available_after"),
                        resultSet.getLong("reserved_after"),
                        resultSet.getString("business_type"),
                        resultSet.getString("business_id"),
                        resultSet.getString("reason"),
                        instant(resultSet, "created_at")
                ));
    }

    @Override
    public List<ReservationAnomalyRow> findReservationAnomalies(
            String keyword,
            String anomalyType,
            Instant now,
            Instant staleBefore,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    ) {
        MapSqlParameterSource parameters = commonParameters(keyword, null, beforeCreatedAt, beforeId, limit)
                .addValue("now", offset(now))
                .addValue("staleBefore", offset(staleBefore));
        StringBuilder filters = new StringBuilder(" AND r.status = 'reserved'");
        if ("expired".equals(anomalyType)) {
            filters.append(" AND r.expires_at IS NOT NULL AND r.expires_at < :now");
        } else if ("stale".equals(anomalyType)) {
            filters.append(" AND r.expires_at IS NULL AND r.updated_at < :staleBefore");
        } else {
            filters.append("""
                     AND (
                         (r.expires_at IS NOT NULL AND r.expires_at < :now)
                         OR (r.expires_at IS NULL AND r.updated_at < :staleBefore)
                     )
                    """);
        }
        if (keyword != null) {
            filters.append("""
                     AND (
                         lower(coalesce(u.username, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(coalesce(u.email, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(r.user_id::text) LIKE :keyword ESCAPE '\\'
                         OR lower(r.task_id) LIKE :keyword ESCAPE '\\'
                         OR lower(r.attempt_id) LIKE :keyword ESCAPE '\\'
                     )
                    """);
        }
        filters.append(cursorClause(beforeCreatedAt, beforeId, "r.created_at", "r.id"));
        return jdbcTemplate.query("""
                        SELECT r.id, r.user_id, u.username, u.email, r.tenant_id,
                               t.display_name AS tenant_name, r.task_id, r.attempt_id,
                               r.reserved_credits, r.settled_credits, r.released_credits,
                               r.status,
                               CASE
                                   WHEN r.expires_at IS NOT NULL AND r.expires_at < :now
                                       THEN 'expired'
                                   ELSE 'stale'
                               END AS anomaly_type,
                               r.expires_at, r.created_at, r.updated_at
                        FROM billing.credit_reservations r
                        JOIN identity.users u ON u.id = r.user_id
                        JOIN identity.tenants t ON t.id = r.tenant_id
                        WHERE 1 = 1
                        %s
                        ORDER BY r.created_at DESC, r.id DESC
                        LIMIT :limit
                        """.formatted(filters),
                parameters,
                (resultSet, rowNumber) -> reservationAnomalyRow(resultSet));
    }

    private ReservationAnomalyRow reservationAnomalyRow(ResultSet resultSet) throws SQLException {
        return new ReservationAnomalyRow(
                uuid(resultSet, "id"),
                uuid(resultSet, "user_id"),
                resultSet.getString("username"),
                resultSet.getString("email"),
                uuid(resultSet, "tenant_id"),
                resultSet.getString("tenant_name"),
                resultSet.getString("task_id"),
                resultSet.getString("attempt_id"),
                resultSet.getLong("reserved_credits"),
                resultSet.getLong("settled_credits"),
                resultSet.getLong("released_credits"),
                resultSet.getString("status"),
                resultSet.getString("anomaly_type"),
                instant(resultSet, "expires_at"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at")
        );
    }

    private MapSqlParameterSource commonParameters(
            String keyword,
            String status,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    ) {
        MapSqlParameterSource parameters = new MapSqlParameterSource("limit", limit);
        if (keyword != null) {
            parameters.addValue("keyword", '%' + escapeLike(keyword.toLowerCase(Locale.ROOT)) + '%');
        }
        if (status != null) {
            parameters.addValue("status", status);
        }
        if (beforeCreatedAt != null && beforeId != null) {
            parameters.addValue("beforeCreatedAt", offset(beforeCreatedAt));
            parameters.addValue("beforeId", beforeId);
        }
        return parameters;
    }

    private String userFilters(String keyword, String status, String alias) {
        StringBuilder filters = new StringBuilder();
        if (status != null) {
            filters.append(" AND ").append(alias).append(".status = :status");
        }
        if (keyword != null) {
            filters.append("""
                     AND (
                         lower(coalesce(u.username, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(coalesce(u.email, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(u.id::text) LIKE :keyword ESCAPE '\\'
                     )
                    """);
        }
        return filters.toString();
    }

    private String cursorClause(Instant beforeCreatedAt, UUID beforeId, String timeColumn, String idColumn) {
        if (beforeCreatedAt == null || beforeId == null) {
            return "";
        }
        return " AND (" + timeColumn + ", " + idColumn + ") < (:beforeCreatedAt, :beforeId)";
    }

    private UUID uuid(ResultSet resultSet, String column) throws SQLException {
        return resultSet.getObject(column, UUID.class);
    }

    private UUID nullableUuid(ResultSet resultSet, String column) throws SQLException {
        return resultSet.getObject(column, UUID.class);
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private OffsetDateTime offset(Instant value) {
        return OffsetDateTime.ofInstant(value, ZoneOffset.UTC);
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }
}
