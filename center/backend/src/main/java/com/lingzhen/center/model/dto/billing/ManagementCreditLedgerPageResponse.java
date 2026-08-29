package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ManagementCreditLedgerPageResponse(
        List<LedgerItem> items,
        String nextCursor
) {

    public ManagementCreditLedgerPageResponse {
        items = List.copyOf(items);
    }

    public record LedgerItem(
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
}
