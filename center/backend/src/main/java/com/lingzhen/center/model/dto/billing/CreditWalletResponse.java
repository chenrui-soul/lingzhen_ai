package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.UUID;

public record CreditWalletResponse(
        UUID userId,
        long availableBalance,
        long reservedBalance,
        Instant updatedAt
) {
}
