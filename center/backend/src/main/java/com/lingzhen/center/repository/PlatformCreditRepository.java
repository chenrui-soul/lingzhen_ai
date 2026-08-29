package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface PlatformCreditRepository {

    Optional<PriceRow> findActivePrice(UUID modelId);

    Optional<PriceRow> findPriceVersion(UUID priceVersionId);

    Optional<ReservationRow> findByTaskId(String taskId);

    CreditMutationResult reserve(ReserveCommand command);

    CreditMutationResult settle(SettleCommand command);

    CreditMutationResult release(ReleaseCommand command);

    record ReserveCommand(
            UUID reservationId,
            UUID userId,
            UUID tenantId,
            String taskId,
            String attemptId,
            String clientRequestId,
            UUID priceVersionId,
            long reservedCredits,
            String idempotencyKey,
            Instant expiresAt,
            UUID ledgerId
    ) {
    }

    record SettleCommand(
            UUID reservationId,
            String taskId,
            String attemptId,
            long chargedCredits,
            String resultReference,
            String idempotencyKey,
            UUID settlementId,
            UUID ledgerId
    ) {
    }

    record ReleaseCommand(
            UUID reservationId,
            String taskId,
            String attemptId,
            String idempotencyKey,
            UUID ledgerId
    ) {
    }

    record CreditMutationResult(
            UUID reservationId,
            String status,
            boolean idempotentReplay,
            long availableBalance,
            long reservedBalance
    ) {
    }

    record PriceRow(UUID id, UUID modelId, long baseCredits, long maxReserveCredits) {
    }

    record ReservationRow(UUID id, String taskId, String attemptId, UUID priceVersionId,
                          long reservedCredits, long settledCredits, long releasedCredits,
                          String status) {
    }
}
