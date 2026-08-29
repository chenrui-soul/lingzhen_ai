package com.lingzhen.center.model.dto.auth;

import com.lingzhen.center.model.enums.ClientType;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record SessionContext(
        UUID sessionId,
        UUID userId,
        String username,
        String email,
        UUID tenantId,
        String tenantCode,
        String tenantName,
        UUID membershipId,
        UUID deviceId,
        ClientType clientType,
        String roleCode,
        Set<String> permissions,
        Map<String, String> featurePolicies,
        Instant expiresAt
) {
}
