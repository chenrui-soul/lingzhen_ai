package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CreditLedgerPageResponse(
        List<LedgerItem> items,
        String nextCursor
) {

    public CreditLedgerPageResponse {
        items = List.copyOf(items);
    }

    public record LedgerItem(
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
