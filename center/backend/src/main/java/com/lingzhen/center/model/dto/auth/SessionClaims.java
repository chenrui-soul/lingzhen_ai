package com.lingzhen.center.model.dto.auth;

import com.lingzhen.center.model.enums.ClientType;

import java.util.UUID;

public record SessionClaims(
        UUID sessionId,
        UUID userId,
        UUID tenantId,
        UUID membershipId,
        UUID deviceId,
        ClientType clientType
) {
}
