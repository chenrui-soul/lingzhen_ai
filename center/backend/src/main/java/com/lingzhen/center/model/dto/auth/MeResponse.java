package com.lingzhen.center.model.dto.auth;

import com.lingzhen.center.model.enums.ClientType;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record MeResponse(
        UUID userId,
        String username,
        String email,
        UUID tenantId,
        String tenantCode,
        String tenantName,
        UUID membershipId,
        UUID sessionId,
        UUID deviceId,
        ClientType clientType,
        String role,
        Set<String> permissions,
        Map<String, String> featurePolicies,
        Instant sessionExpiresAt
) {
}
