package com.lingzhen.center.service.impl;

import com.lingzhen.center.model.dto.auth.SessionClaims;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.repository.AuthIdentityStore;
import com.lingzhen.center.service.SessionAccessService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.util.Optional;

@Service
public class SessionAccessServiceImpl implements SessionAccessService {

    private final AuthIdentityStore identityStore;
    private final Clock clock;

    public SessionAccessServiceImpl(AuthIdentityStore identityStore, Clock clock) {
        this.identityStore = identityStore;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<SessionContext> verify(SessionClaims claims) {
        return identityStore.findSessionAccess(claims.sessionId(), clock.instant())
                .filter(access -> access.userId().equals(claims.userId()))
                .filter(access -> access.tenantId().equals(claims.tenantId()))
                .filter(access -> access.membershipId().equals(claims.membershipId()))
                .filter(access -> access.deviceId().equals(claims.deviceId()))
                .filter(access -> access.clientType() == claims.clientType());
    }
}
