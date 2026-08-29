package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.UUID;

public record RechargeOrderResponse(
        UUID id,
        String orderNo,
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
        boolean idempotentReplay
) {
}
