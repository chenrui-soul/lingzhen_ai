package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.AuthProperties;
import com.lingzhen.center.repository.AuthIdentityStore;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.UUID;

@Service
public class LoginFailureService {

    private final AuthIdentityStore identityStore;
    private final AuthProperties properties;
    private final Clock clock;

    public LoginFailureService(
            AuthIdentityStore identityStore,
            AuthProperties properties,
            Clock clock
    ) {
        this.identityStore = identityStore;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordFailure(UUID userId) {
        AuthIdentityStore.UserAccount user = identityStore.findUserForUpdate(userId).orElse(null);
        if (user == null || !"active".equals(user.status())) {
            return;
        }

        Instant now = clock.instant();
        int failureCount = user.failedLoginCount() + 1;
        Instant lockedUntil = failureCount >= properties.loginLockThreshold()
                ? now.plus(properties.loginLockDuration())
                : null;
        identityStore.recordFailedLogin(userId, failureCount, lockedUntil, now);
        if (lockedUntil != null) {
            identityStore.revokeUserSessions(userId, now, "login_failure_lock");
        }
    }
}
