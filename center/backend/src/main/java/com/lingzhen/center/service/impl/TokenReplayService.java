package com.lingzhen.center.service.impl;

import com.lingzhen.center.repository.AuthIdentityStore;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Service
public class TokenReplayService {

    private final AuthIdentityStore identityStore;
    private final Clock clock;

    public TokenReplayService(AuthIdentityStore identityStore, Clock clock) {
        this.identityStore = identityStore;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void revokeFamily(UUID tokenId, UUID familyId, UUID sessionId) {
        Instant now = clock.instant();
        identityStore.markRefreshTokenReused(tokenId, now, "refresh_token_reuse");
        identityStore.revokeRefreshFamily(familyId, now, "refresh_token_reuse");
        identityStore.revokeSession(sessionId, now, "refresh_token_reuse");
    }
}
