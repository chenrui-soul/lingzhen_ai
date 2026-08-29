package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RechargeRepository {

    List<PackageRow> findPackages(boolean activeOnly);

    Optional<PackageRow> findPackage(UUID packageId);

    Optional<PackageRow> createPackage(PackageCreateCommand command);

    Optional<PackageRow> updatePackage(PackageUpdateCommand command);

    Optional<OrderRow> createOrder(OrderCreateCommand command);

    Optional<OrderRow> createManualOrder(OrderCreateCommand command);

    Optional<OrderRow> findOrder(UUID orderId);

    Optional<OrderRow> findUserOrder(UUID userId, UUID orderId);

    List<OrderRow> findUserOrders(UUID userId, int limit);

    Optional<OrderRow> closeOrder(UUID orderId, UUID userId, Instant closedAt, boolean requireExpired);

    PaymentApplyResult applySandboxPayment(PaymentApplyCommand command);

    PaymentApplyResult approveManualRecharge(ManualReviewCommand command);

    Optional<OrderRow> rejectManualRecharge(ManualReviewCommand command);

    Optional<OrderRow> cancelManualOrder(UUID orderId, UUID userId, Instant closedAt);

    PaymentApplyResult grantAdminCredits(ManualGrantCommand command);

    record PackageCreateCommand(
            UUID id,
            String code,
            String displayName,
            long cashAmountCents,
            long creditAmount,
            long bonusCredits,
            int sortOrder,
            UUID createdByUserId
    ) {
    }

    record PackageUpdateCommand(
            UUID id,
            String displayName,
            long cashAmountCents,
            long creditAmount,
            long bonusCredits,
            String status,
            int sortOrder,
            long rowVersion
    ) {
    }

    record OrderCreateCommand(
            UUID id,
            String orderNo,
            UUID userId,
            UUID packageId,
            String paymentChannel,
            String idempotencyKey,
            Instant expiresAt,
            String submissionNote
    ) {
    }

    record PaymentApplyCommand(
            UUID orderId,
            String channelTradeNo,
            String eventId,
            long cashAmountCents,
            Instant paidAt,
            UUID ledgerId
    ) {
    }

    record ManualReviewCommand(
            UUID orderId,
            UUID operatorUserId,
            String reason,
            Instant reviewedAt,
            UUID ledgerId
    ) {
    }

    record ManualGrantCommand(
            UUID targetUserId,
            UUID operatorUserId,
            long credits,
            String reason,
            String idempotencyKey,
            UUID grantId
    ) {
    }

    record PackageRow(
            UUID id,
            String code,
            String displayName,
            long cashAmountCents,
            long creditAmount,
            long bonusCredits,
            String status,
            int sortOrder,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) {
    }

    record OrderRow(
            UUID id,
            String orderNo,
            UUID userId,
            UUID packageId,
            String packageCode,
            long cashAmountCents,
            long creditAmount,
            long bonusCredits,
            String paymentChannel,
            String status,
            Instant expiresAt,
            Instant paidAt,
            Instant closedAt,
            String submissionNote,
            String reviewReason,
            Instant reviewedAt,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) {
        public OrderRow(
                UUID id,
                String orderNo,
                UUID userId,
                UUID packageId,
                String packageCode,
                long cashAmountCents,
                long creditAmount,
                long bonusCredits,
                String paymentChannel,
                String status,
                Instant expiresAt,
                Instant paidAt,
                Instant closedAt,
                Instant createdAt,
                Instant updatedAt,
                long rowVersion
        ) {
            this(
                    id, orderNo, userId, packageId, packageCode,
                    cashAmountCents, creditAmount, bonusCredits, paymentChannel, status,
                    expiresAt, paidAt, closedAt, null, null, null, createdAt, updatedAt, rowVersion
            );
        }
    }

    record PaymentApplyResult(
            String orderStatus,
            boolean idempotentReplay,
            long availableBalance,
            long reservedBalance
    ) {
    }
}
