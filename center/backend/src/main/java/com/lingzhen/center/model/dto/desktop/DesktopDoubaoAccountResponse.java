package com.lingzhen.center.model.dto.desktop;

import java.time.Instant;

public record DesktopDoubaoAccountResponse(
        String accountId,
        String displayName,
        String loginState,
        String loginSummary,
        Instant lastCheckedAt,
        Instant updatedAt,
        long rowVersion
) {
}
