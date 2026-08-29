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
import java.util.Optional;
import java.util.UUID;

@Repository
public class RechargePersistenceAdapter implements RechargeRepository {

    private final NamedParameterJdbcTemplate jdbcTemplate;

    public RechargePersistenceAdapter(NamedParameterJdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public List<PackageRow> findPackages(boolean activeOnly) {
        String filter = activeOnly ? "WHERE status = 'active'" : "";
        return jdbcTemplate.query("""
                        SELECT id, package_code, display_name, cash_amount_cents,
                               credit_amount, bonus_credits, status, sort_order,
                               created_at, updated_at, row_version
                        FROM billing.recharge_packages
                        %s
                        ORDER BY sort_order, cash_amount_cents, id
                        LIMIT 100
                        """.formatted(filter),
                new MapSqlParameterSource(),
                (resultSet, rowNumber) -> packageRow(resultSet)
        );
    }

    @Override
    public Optional<PackageRow> findPackage(UUID packageId) {
        return jdbcTemplate.query("""
                        SELECT id, package_code, display_name, cash_amount_cents,
                               credit_amount, bonus_credits, status, sort_order,
                               created_at, updated_at, row_version
                        FROM billing.recharge_packages
                        WHERE id = :packageId
                        """,
                new MapSqlParameterSource("packageId", packageId),
                (resultSet, rowNumber) -> packageRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<PackageRow> createPackage(PackageCreateCommand command) {
        return jdbcTemplate.query("""
                        SELECT id, package_code, display_name, cash_amount_cents,
                               credit_amount, bonus_credits, status, sort_order,
                               created_at, updated_at, row_version
                        FROM billing.create_recharge_package(
                            :id, :code, :displayName, :cashAmountCents,
                            :creditAmount, :bonusCredits, :sortOrder, :createdByUserId
                        )
                        """,
                packageParameters(command),
                (resultSet, rowNumber) -> packageRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<PackageRow> updatePackage(PackageUpdateCommand command) {
        return jdbcTemplate.query("""
                        SELECT id, package_code, display_name, cash_amount_cents,
                               credit_amount, bonus_credits, status, sort_order,
                               created_at, updated_at, row_version
                        FROM billing.update_recharge_package(
                            :id, :displayName, :cashAmountCents, :creditAmount,
                            :bonusCredits, :status, :sortOrder, :rowVersion
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("displayName", command.displayName())
                        .addValue("cashAmountCents", command.cashAmountCents())
                        .addValue("creditAmount", command.creditAmount())
                        .addValue("bonusCredits", command.bonusCredits())
                        .addValue("status", command.status())
                        .addValue("sortOrder", command.sortOrder())
                        .addValue("rowVersion", command.rowVersion()),
                (resultSet, rowNumber) -> packageRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<OrderRow> createOrder(OrderCreateCommand command) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.create_recharge_order(
                            :id, :orderNo, :userId, :packageId, :paymentChannel,
                            :idempotencyKey, :expiresAt
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("orderNo", command.orderNo())
                        .addValue("userId", command.userId())
                        .addValue("packageId", command.packageId())
                        .addValue("paymentChannel", command.paymentChannel())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("expiresAt", offset(command.expiresAt())),
                (resultSet, rowNumber) -> orderRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<OrderRow> createManualOrder(OrderCreateCommand command) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.create_manual_recharge_order(
                            :id, :orderNo, :userId, :packageId,
                            :idempotencyKey, :expiresAt, :submissionNote
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("orderNo", command.orderNo())
                        .addValue("userId", command.userId())
                        .addValue("packageId", command.packageId())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("expiresAt", offset(command.expiresAt()))
                        .addValue("submissionNote", command.submissionNote()),
                (resultSet, rowNumber) -> orderRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<OrderRow> findOrder(UUID orderId) {
        return findOrder("id = :orderId", new MapSqlParameterSource("orderId", orderId));
    }

    @Override
    public Optional<OrderRow> findUserOrder(UUID userId, UUID orderId) {
        return findOrder(
                "id = :orderId AND user_id = :userId",
                new MapSqlParameterSource().addValue("orderId", orderId).addValue("userId", userId)
        );
    }

    @Override
    public List<OrderRow> findUserOrders(UUID userId, int limit) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.recharge_orders
                        WHERE user_id = :userId
                        ORDER BY created_at DESC, id DESC
                        LIMIT :limit
                        """,
                new MapSqlParameterSource()
                        .addValue("userId", userId)
                        .addValue("limit", limit),
                (resultSet, rowNumber) -> orderRow(resultSet)
        );
    }

    @Override
    public Optional<OrderRow> closeOrder(
            UUID orderId,
            UUID userId,
            Instant closedAt,
            boolean requireExpired
    ) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.close_recharge_order(
                            :orderId, :userId, :closedAt, :requireExpired
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("orderId", orderId)
                        .addValue("userId", userId)
                        .addValue("closedAt", offset(closedAt))
                        .addValue("requireExpired", requireExpired),
                (resultSet, rowNumber) -> orderRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public PaymentApplyResult applySandboxPayment(PaymentApplyCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT order_status, idempotent_replay,
                               available_balance, reserved_balance
                        FROM billing.apply_sandbox_payment(
                            :orderId, :channelTradeNo, :eventId, :cashAmountCents,
                            :paidAt, :ledgerId
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("orderId", command.orderId())
                        .addValue("channelTradeNo", command.channelTradeNo())
                        .addValue("eventId", command.eventId())
                        .addValue("cashAmountCents", command.cashAmountCents())
                        .addValue("paidAt", offset(command.paidAt()))
                        .addValue("ledgerId", command.ledgerId()),
                (resultSet, rowNumber) -> new PaymentApplyResult(
                        resultSet.getString("order_status"),
                        resultSet.getBoolean("idempotent_replay"),
                        resultSet.getLong("available_balance"),
                        resultSet.getLong("reserved_balance")
                )
        );
    }

    @Override
    public PaymentApplyResult approveManualRecharge(ManualReviewCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT order_status, idempotent_replay,
                               available_balance, reserved_balance
                        FROM billing.approve_manual_recharge_order(
                            :orderId, :operatorUserId, :reason, :reviewedAt, :ledgerId
                        )
                        """,
                reviewParameters(command),
                (resultSet, rowNumber) -> new PaymentApplyResult(
                        resultSet.getString("order_status"),
                        resultSet.getBoolean("idempotent_replay"),
                        resultSet.getLong("available_balance"),
                        resultSet.getLong("reserved_balance")
                )
        );
    }

    @Override
    public Optional<OrderRow> rejectManualRecharge(ManualReviewCommand command) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.reject_manual_recharge_order(
                            :orderId, :operatorUserId, :reason, :reviewedAt
                        )
                        """,
                reviewParameters(command),
                (resultSet, rowNumber) -> orderRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public Optional<OrderRow> cancelManualOrder(UUID orderId, UUID userId, Instant closedAt) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.cancel_manual_recharge_order(:orderId, :userId, :closedAt)
                        """,
                new MapSqlParameterSource()
                        .addValue("orderId", orderId)
                        .addValue("userId", userId)
                        .addValue("closedAt", offset(closedAt)),
                (resultSet, rowNumber) -> orderRow(resultSet)
        ).stream().findFirst();
    }

    @Override
    public PaymentApplyResult grantAdminCredits(ManualGrantCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT available_balance, reserved_balance, idempotent_replay
                        FROM billing.grant_admin_credits(
                            :targetUserId, :operatorUserId, :credits, :reason,
                            :idempotencyKey, :grantId
                        )
                        """,
                new MapSqlParameterSource()
                        .addValue("targetUserId", command.targetUserId())
                        .addValue("operatorUserId", command.operatorUserId())
                        .addValue("credits", command.credits())
                        .addValue("reason", command.reason())
                        .addValue("idempotencyKey", command.idempotencyKey())
                        .addValue("grantId", command.grantId()),
                (resultSet, rowNumber) -> new PaymentApplyResult(
                        "granted",
                        resultSet.getBoolean("idempotent_replay"),
                        resultSet.getLong("available_balance"),
                        resultSet.getLong("reserved_balance")
                )
        );
    }

    private Optional<OrderRow> findOrder(String filter, MapSqlParameterSource parameters) {
        return jdbcTemplate.query("""
                        SELECT id, order_no, user_id, package_id, package_code_snapshot,
                               cash_amount_cents, credit_amount, bonus_credits,
                               payment_channel, status, expires_at, paid_at, closed_at,
                               submission_note, review_reason, reviewed_at,
                               created_at, updated_at, row_version
                        FROM billing.recharge_orders
                        WHERE %s
                        """.formatted(filter),
                parameters,
                (resultSet, rowNumber) -> orderRow(resultSet)
        ).stream().findFirst();
    }

    private MapSqlParameterSource packageParameters(PackageCreateCommand command) {
        return new MapSqlParameterSource()
                .addValue("id", command.id())
                .addValue("code", command.code())
                .addValue("displayName", command.displayName())
                .addValue("cashAmountCents", command.cashAmountCents())
                .addValue("creditAmount", command.creditAmount())
                .addValue("bonusCredits", command.bonusCredits())
                .addValue("sortOrder", command.sortOrder())
                .addValue("createdByUserId", command.createdByUserId());
    }

    private MapSqlParameterSource reviewParameters(ManualReviewCommand command) {
        return new MapSqlParameterSource()
                .addValue("orderId", command.orderId())
                .addValue("operatorUserId", command.operatorUserId())
                .addValue("reason", command.reason())
                .addValue("reviewedAt", offset(command.reviewedAt()))
                .addValue("ledgerId", command.ledgerId());
    }

    private PackageRow packageRow(ResultSet resultSet) throws SQLException {
        return new PackageRow(
                uuid(resultSet, "id"),
                resultSet.getString("package_code"),
                resultSet.getString("display_name"),
                resultSet.getLong("cash_amount_cents"),
                resultSet.getLong("credit_amount"),
                resultSet.getLong("bonus_credits"),
                resultSet.getString("status"),
                resultSet.getInt("sort_order"),
                instant(resultSet, "created_at"),
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    private OrderRow orderRow(ResultSet resultSet) throws SQLException {
        return new OrderRow(
                uuid(resultSet, "id"),
                resultSet.getString("order_no"),
                uuid(resultSet, "user_id"),
                uuid(resultSet, "package_id"),
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
                instant(resultSet, "updated_at"),
                resultSet.getLong("row_version")
        );
    }

    private UUID uuid(ResultSet resultSet, String column) throws SQLException {
        return resultSet.getObject(column, UUID.class);
    }

    private Instant instant(ResultSet resultSet, String column) throws SQLException {
        OffsetDateTime value = resultSet.getObject(column, OffsetDateTime.class);
        return value == null ? null : value.toInstant();
    }

    private OffsetDateTime offset(Instant value) {
        return OffsetDateTime.ofInstant(value, ZoneOffset.UTC);
    }
}
