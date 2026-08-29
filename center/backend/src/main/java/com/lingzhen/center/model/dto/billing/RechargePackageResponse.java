package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.UUID;

public record RechargePackageResponse(
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
