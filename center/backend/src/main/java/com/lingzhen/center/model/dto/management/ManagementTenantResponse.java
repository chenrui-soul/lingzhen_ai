package com.lingzhen.center.model.dto.management;

import java.time.Instant;
import java.util.UUID;

public record ManagementTenantResponse(
        UUID id,
        String code,
        String name,
        String status,
        Instant createdAt,
        ManagementTenantMetrics metrics
) {

    public record ManagementTenantMetrics(
            long totalMembers,
            long activeMembers,
            long suspendedMembers,
            long activeSessions
    ) {
    }
}
