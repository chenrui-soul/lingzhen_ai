package com.lingzhen.center.model.dto.billing;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ManagementCreditWalletPageResponse(
        List<WalletItem> items,
        String nextCursor
) {

    public ManagementCreditWalletPageResponse {
        items = List.copyOf(items);
    }

    public record WalletItem(
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
}
