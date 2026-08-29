package com.lingzhen.center.model.dto.auth;

import java.util.UUID;

public record TenantMembershipView(
        UUID id,
        UUID tenantId,
        String tenantCode,
        String tenantName,
        String tenantStatus,
        UUID roleId,
        String roleCode,
        String membershipStatus
) {
}
