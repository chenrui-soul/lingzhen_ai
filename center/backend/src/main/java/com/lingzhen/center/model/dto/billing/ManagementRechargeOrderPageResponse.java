package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ManagementRechargeOrderPageResponse(
        List<OrderItem> items,
        String nextCursor
) {

    public ManagementRechargeOrderPageResponse {
        items = List.copyOf(items);
    }

    public record OrderItem(
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
    }
}
