package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.ZoneOffset;
import java.util.Optional;
import java.util.UUID;

@Repository
public class PlatformCreditPersistenceAdapter implements PlatformCreditRepository {

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public PlatformCreditPersistenceAdapter(NamedParameterJdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public Optional<PriceRow> findActivePrice(UUID modelId) {
        return priceRows("model_id = :id AND status = 'active'", modelId).stream().findFirst();
    }

    @Override
    public Optional<PriceRow> findPriceVersion(UUID priceVersionId) {
        return priceRows("id = :id", priceVersionId).stream().findFirst();
    }

    @Override
    public Optional<ReservationRow> findByTaskId(String taskId) {
        return jdbcTemplate.query("""
                        SELECT id, task_id, attempt_id, price_version_id,
                               reserved_credits, settled_credits, released_credits, status
                        FROM billing.credit_reservations
                        WHERE task_id = :taskId
                        ORDER BY created_at DESC, id DESC
                        LIMIT 1
                        """, new MapSqlParameterSource().addValue("taskId", taskId),
                (rs, row) -> new ReservationRow(
                        rs.getObject("id", UUID.class),
                        rs.getString("task_id"),
                        rs.getString("attempt_id"),
                        rs.getObject("price_version_id", UUID.class),
                        rs.getLong("reserved_credits"),
                        rs.getLong("settled_credits"),
                        rs.getLong("released_credits"),
                        rs.getString("status")
                )).stream().findFirst();
    }

    @Override
    public CreditMutationResult reserve(ReserveCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT reservation_id, reservation_status, idempotent_replay,
                               available_balance, reserved_balance
                        FROM billing.reserve_platform_credits(
                            :reservationId, :userId, :tenantId, :taskId, :attemptId,
                            :clientRequestId, :priceVersionId, :reservedCredits,
                            :idempotencyKey, :expiresAt, :ledgerId
                        )
                        """, new MapSqlParameterSource()
                        .addValue("reservationId", command.reservationId())
                        .addValue("userId", command.userId())
                        .addValue("tenantId", command.tenantId())
                        .addValue("taskId", command.taskId())
                        .addValue("attemptId", command.attemptId())
                        .addValue("clientRequestId", command.clientRequestId())
                        .addValue("priceVersionId", command.priceVersionId())
                        .addValue("reservedCredits", command.reservedCredits())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("expiresAt", command.expiresAt() == null ? null : command.expiresAt().atOffset(ZoneOffset.UTC))
                        .addValue("ledgerId", command.ledgerId()),
                (rs, row) -> result(rs));
    }

    @Override
    public CreditMutationResult settle(SettleCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT reservation_id, reservation_status, idempotent_replay,
                               available_balance, reserved_balance
                        FROM billing.settle_platform_credits(
                            :reservationId, :taskId, :attemptId, :chargedCredits,
                            :resultReference, :idempotencyKey, :settlementId, :ledgerId
                        )
                        """, new MapSqlParameterSource()
                        .addValue("reservationId", command.reservationId())
                        .addValue("taskId", command.taskId())
                        .addValue("attemptId", command.attemptId())
                        .addValue("chargedCredits", command.chargedCredits())
                        .addValue("resultReference", command.resultReference())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("settlementId", command.settlementId())
                        .addValue("ledgerId", command.ledgerId()),
                (rs, row) -> result(rs));
    }

    @Override
    public CreditMutationResult release(ReleaseCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT reservation_id, reservation_status, idempotent_replay,
                               available_balance, reserved_balance
                        FROM billing.release_platform_credits(
                            :reservationId, :taskId, :attemptId, :idempotencyKey, :ledgerId
                        )
                        """, new MapSqlParameterSource()
                        .addValue("reservationId", command.reservationId())
                        .addValue("taskId", command.taskId())
                        .addValue("attemptId", command.attemptId())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("ledgerId", command.ledgerId()),
                (rs, row) -> result(rs));
    }

    private CreditMutationResult result(java.sql.ResultSet resultSet) throws java.sql.SQLException {
        return new CreditMutationResult(
                resultSet.getObject("reservation_id", java.util.UUID.class),
                resultSet.getString("reservation_status"),
                resultSet.getBoolean("idempotent_replay"),
                resultSet.getLong("available_balance"),
                resultSet.getLong("reserved_balance")
        );
    }

    private java.util.List<PriceRow> priceRows(String predicate, UUID id) {
        return jdbcTemplate.query("""
                        SELECT id, model_id, base_credits, max_reserve_credits
                        FROM billing.model_price_versions
                        WHERE %s
                        ORDER BY version_no DESC
                        LIMIT 1
                        """.formatted(predicate), new MapSqlParameterSource().addValue("id", id),
                (rs, row) -> new PriceRow(
                        rs.getObject("id", UUID.class),
                        rs.getObject("model_id", UUID.class),
                        rs.getLong("base_credits"),
                        rs.getLong("max_reserve_credits")
                ));
    }
}
