package com.lingzhen.center.model.dto.auth;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record TenantSelectionResponse(
        String status,
        String tenantSelectionTicket,
        Instant expiresAt,
        List<TenantOption> tenants
) {

    public record TenantOption(
            UUID tenantId,
            String tenantCode,
            String tenantName,
            String role
    ) {
    }
}
