package com.lingzhen.center.model.dto.auth;

import com.lingzhen.center.model.enums.ClientType;

import java.time.Instant;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

public record AuthResponse(
        String status,
        String tokenType,
        String accessToken,
        Instant accessTokenExpiresAt,
        String refreshToken,
        Instant refreshTokenExpiresAt,
        SessionSummary session,
        UserSummary user,
        TenantSummary tenant,
        String role,
        Set<String> permissions,
        Map<String, String> featurePolicies
) {

    public record SessionSummary(
            UUID id,
            UUID membershipId,
            UUID deviceId,
            ClientType clientType
    ) {
    }

    public record UserSummary(UUID id, String username, String email) {
    }

    public record TenantSummary(UUID id, String code, String displayName) {
    }
}
