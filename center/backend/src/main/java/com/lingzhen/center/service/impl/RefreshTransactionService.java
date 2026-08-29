package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.AuthProperties;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.repository.AuthIdentityStore;
import com.lingzhen.center.security.SecureTokenGenerator;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Service
public class RefreshTransactionService {

    private final AuthIdentityStore identityStore;
    private final SecureTokenGenerator tokenGenerator;
    private final AuthProperties properties;
    private final Clock clock;

    public RefreshTransactionService(
            AuthIdentityStore identityStore,
            SecureTokenGenerator tokenGenerator,
            AuthProperties properties,
            Clock clock
    ) {
        this.identityStore = identityStore;
        this.tokenGenerator = tokenGenerator;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public RefreshDecision rotate(String rawRefreshToken) {
        Instant now = clock.instant();
        AuthIdentityStore.RefreshToken current = identityStore
                .findRefreshTokenForUpdate(tokenGenerator.hash(rawRefreshToken))
                .orElse(null);
        if (current == null) {
            return InvalidRefresh.INSTANCE;
        }
        if ("rotated".equals(current.status()) || "reused".equals(current.status())) {
            return new ReplayDetected(current.id(), current.familyId(), current.sessionId());
        }
        if (!"active".equals(current.status())) {
            return InvalidRefresh.INSTANCE;
        }
        if (!current.expiresAt().isAfter(now)) {
            identityStore.revokeRefreshFamily(current.familyId(), now, "refresh_token_expired");
            identityStore.revokeSession(current.sessionId(), now, "refresh_token_expired");
            return InvalidRefresh.INSTANCE;
        }

        SessionContext access = identityStore
                .findSessionAccess(current.sessionId(), now)
                .orElse(null);
        if (access == null) {
            identityStore.revokeRefreshFamily(current.familyId(), now, "session_invalid");
            identityStore.revokeSession(current.sessionId(), now, "session_invalid");
            return InvalidRefresh.INSTANCE;
        }

        SecureTokenGenerator.OpaqueToken replacement = tokenGenerator.generate();
        UUID replacementId = UUID.randomUUID();
        Instant expiresAt = now.plus(properties.refreshTokenTtl());
        identityStore.rotateRefreshToken(
                current.id(),
                now,
                new AuthIdentityStore.NewRefreshToken(
                        replacementId,
                        current.sessionId(),
                        current.familyId(),
                        current.id(),
                        replacement.hash(),
                        now,
                        expiresAt
                )
        );
        identityStore.extendSession(current.sessionId(), expiresAt, now);
        SessionContext refreshedAccess = identityStore
                .findSessionAccess(current.sessionId(), now)
                .orElseThrow(() -> new IllegalStateException("Refreshed session failed validation"));
        return new RefreshSucceeded(refreshedAccess, replacement.value(), expiresAt);
    }

    public sealed interface RefreshDecision permits RefreshSucceeded, ReplayDetected, InvalidRefresh {
    }

    public record RefreshSucceeded(
            SessionContext access,
            String refreshToken,
            Instant refreshTokenExpiresAt
    ) implements RefreshDecision {
    }

    public record ReplayDetected(
            UUID tokenId,
            UUID familyId,
            UUID sessionId
    ) implements RefreshDecision {
    }

    public enum InvalidRefresh implements RefreshDecision {
        INSTANCE
    }
}
