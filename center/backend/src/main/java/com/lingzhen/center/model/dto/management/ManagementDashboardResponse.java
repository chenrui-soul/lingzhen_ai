package com.lingzhen.center.model.dto.management;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ManagementDashboardResponse(
        Instant generatedAt,
        ManagementDashboardTenantSummary tenant,
        ManagementDashboardMetrics metrics,
        List<ManagementDashboardRoleSummary> roles
) {

    public record ManagementDashboardTenantSummary(
            UUID id,
            String code,
            String name,
            String status
    ) {
    }

    public record ManagementDashboardMetrics(
            long totalMembers,
            long activeMembers,
            long suspendedMembers,
            long activeSessions
    ) {
    }

    public record ManagementDashboardRoleSummary(
            String code,
            String name,
            long members
    ) {
    }
}
