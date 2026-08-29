package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface BillingWalletRepository {

    Optional<WalletRow> findWallet(UUID userId);

    List<LedgerRow> findLedger(
            UUID userId,
            Instant beforeCreatedAt,
            UUID beforeId,
            int limit
    );

    record WalletRow(
            UUID userId,
            long availableBalance,
            long reservedBalance,
            Instant updatedAt,
            long rowVersion
    ) {
    }

    record LedgerRow(
            UUID id,
            UUID tenantId,
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
}
