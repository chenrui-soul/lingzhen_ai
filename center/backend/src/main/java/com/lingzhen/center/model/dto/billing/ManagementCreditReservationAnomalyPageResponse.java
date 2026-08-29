package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ManagementCreditReservationAnomalyPageResponse(
        List<ReservationAnomalyItem> items,
        String nextCursor
) {

    public ManagementCreditReservationAnomalyPageResponse {
        items = List.copyOf(items);
    }

    public record ReservationAnomalyItem(
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
