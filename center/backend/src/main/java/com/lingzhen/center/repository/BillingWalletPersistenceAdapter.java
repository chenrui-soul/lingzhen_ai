package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Repository
public class BillingWalletPersistenceAdapter implements BillingWalletRepository {

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public BillingWalletPersistenceAdapter(NamedParameterJdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Optional<WalletRow> findWallet(UUID userId) {
        return jdbcTemplate.query("""
                        SELECT user_id, available_balance, reserved_balance, updated_at, row_version
                        FROM billing.user_wallets
                        WHERE user_id = :userId
                        """,
                new MapSqlParameterSource("userId", userId),
                (resultSet, rowNumber) -> new WalletRow(
                        resultSet.getObject("user_id", UUID.class),
                        resultSet.getLong("available_balance"),
                        resultSet.getLong("reserved_balance"),
                        instant(resultSet, "updated_at"),
                        resultSet.getLong("row_version")
                )
        ).stream().findFirst();
    }

    @Override
    public List<LedgerRow> findLedger(
            UUID userId,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    ) {
        MapSqlParameterSource parameters = new MapSqlParameterSource()
                .addValue("userId", userId)
                .addValue("limit", limit);
        String cursorClause = "";
        if (beforeCreatedAt != null && beforeId != null) {
            parameters.addValue("beforeCreatedAt", OffsetDateTime.ofInstant(beforeCreatedAt, java.time.ZoneOffset.UTC));
            parameters.addValue("beforeId", beforeId);
            cursorClause = "AND (created_at, id) < (:beforeCreatedAt, :beforeId)";
        }
        return jdbcTemplate.query("""
                        SELECT id, tenant_id, entry_type, available_delta, reserved_delta,
                               available_after, reserved_after, business_type, business_id,
                               reason, created_at
                        FROM billing.credit_ledger_entries
                        WHERE user_id = :userId
                        %s
                        ORDER BY created_at DESC, id DESC
                        LIMIT :limit
                        """.formatted(cursorClause),
                parameters,
                (resultSet, rowNumber) -> ledgerRow(resultSet)
        );
    }

    private LedgerRow ledgerRow(ResultSet resultSet) throws SQLException {
        return new LedgerRow(
                resultSet.getObject("id", UUID.class),
                resultSet.getObject("tenant_id", UUID.class),
                resultSet.getString("entry_type"),
                resultSet.getLong("available_delta"),
                resultSet.getLong("reserved_delta"),
                resultSet.getLong("available_after"),
                resultSet.getLong("reserved_after"),
                resultSet.getString("business_type"),
                resultSet.getString("business_id"),
                resultSet.getString("reason"),
                instant(resultSet, "created_at")
        );
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }
}
