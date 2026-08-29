package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface CreditsManagementRepository {

    List<WalletRow> findWallets(
            String keyword,
            String status,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    );

    List<OrderRow> findOrders(
            String keyword,
            String status,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    );

    List<LedgerRow> findLedger(
            String keyword,
            String entryType,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    );

    List<ReservationAnomalyRow> findReservationAnomalies(
            String keyword,
            String anomalyType,
            Instant now,
            Instant staleBefore,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    );

    record WalletRow(
            UUID userId,
            String username,
            String email,
            String userStatus,
            long availableBalance,
            long reservedBalance,
            Instant createdAt,
            Instant updatedAt
    ) {
    }

    record OrderRow(
            UUID id,
            String orderNo,
            UUID userId,
            String username,
            String email,
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
            Instant updatedAt
    ) {
        public OrderRow(
                UUID id,
                String orderNo,
                UUID userId,
                String username,
                String email,
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
                Instant updatedAt
        ) {
            this(
                    id, orderNo, userId, username, email, packageCode,
                    cashAmountCents, creditAmount, bonusCredits, paymentChannel, status,
                    expiresAt, paidAt, closedAt, null, null, null, createdAt, updatedAt
            );
        }
    }

    record LedgerRow(
            UUID id,
            UUID userId,
            String username,
            String email,
            UUID tenantId,
            String tenantName,
            String entryType,
            long availableDelta,
            long reservedDelta,
            long availableAfter,
            long reservedAfter,
            String businessType,
            String businessId,
            String reason,
            Instant createdAt
    ) {
    }

    record ReservationAnomalyRow(
            UUID id,
            UUID userId,
            String username,
            String email,
            UUID tenantId,
            String tenantName,
            String taskId,
            String attemptId,
            long reservedCredits,
            long settledCredits,
            long releasedCredits,
            String status,
            String anomalyType,
            Instant expiresAt,
            Instant createdAt,
            Instant updatedAt
    ) {
    }
}
