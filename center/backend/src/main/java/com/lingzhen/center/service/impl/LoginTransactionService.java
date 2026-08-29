package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.AuthProperties;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.LoginRequest;
import com.lingzhen.center.model.dto.auth.TenantMembershipView;
import com.lingzhen.center.repository.AuthIdentityStore;
import com.lingzhen.center.security.PasswordHasher;
import com.lingzhen.center.security.SecureTokenGenerator;
import com.lingzhen.center.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

@Service
public class LoginTransactionService {

    private final AuthIdentityStore identityStore;
    private final PasswordHasher passwordHasher;
    private final SecureTokenGenerator tokenGenerator;
    private final SessionCreationService sessionCreationService;
    private final AuthProperties properties;
    private final Clock clock;

    public LoginTransactionService(
            AuthIdentityStore identityStore,
            PasswordHasher passwordHasher,
            SecureTokenGenerator tokenGenerator,
            SessionCreationService sessionCreationService,
            AuthProperties properties,
            Clock clock
    ) {
        this.identityStore = identityStore;
        this.passwordHasher = passwordHasher;
        this.tokenGenerator = tokenGenerator;
        this.sessionCreationService = sessionCreationService;
        this.properties = properties;
        this.clock = clock;
    }

    @Transactional
    public LoginDecision authenticate(LoginRequest request, AuthService.RequestMetadata metadata) {
        Instant now = clock.instant();
        AuthIdentityStore.UserAccount user = identityStore
                .findUserByLoginForUpdate(request.identity())
                .orElse(null);
        if (user == null) {
            passwordHasher.consumeDummyVerification(request.password());
            return new InvalidCredentials(null);
        }

        validateUserState(user, now);
        if (!passwordHasher.matches(request.password(), user.passwordHash())) {
            return new InvalidCredentials(user.id());
        }

        List<TenantMembershipView> memberships = identityStore.findActiveMemberships(user.id());
        if (memberships.isEmpty()) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "NO_ACTIVE_MEMBERSHIP",
                    "当前账号没有可用租户"
            );
        }

        identityStore.recordSuccessfulLogin(user.id(), now);
        if (memberships.size() == 1) {
            AuthService.AuthenticatedSession session = sessionCreationService.create(
                    user.id(),
                    memberships.getFirst(),
                    request.clientType(),
                    request.device(),
                    metadata,
                    now
            );
            return new LoginSucceeded(session);
        }

        SecureTokenGenerator.OpaqueToken ticket = tokenGenerator.generate();
        UUID ticketId = UUID.randomUUID();
        Instant expiresAt = now.plus(properties.tenantSelectionTicketTtl());
        identityStore.createTenantSelectionTicket(
                new AuthIdentityStore.NewTenantSelectionTicket(
                        ticketId,
                        user.id(),
                        ticket.hash(),
                        request.device().deviceHash(),
                        (short) request.device().fingerprintVersion(),
                        request.clientType(),
                        expiresAt,
                        now
                ),
                memberships
        );
        return new SelectionRequired(new AuthService.TenantSelectionRequired(
                ticket.value(),
                expiresAt,
                memberships
        ));
    }

    private void validateUserState(AuthIdentityStore.UserAccount user, Instant now) {
        if ("disabled".equals(user.status())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "USER_DISABLED", "当前账号已被停用");
        }
        if ("pending".equals(user.status())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "USER_PENDING", "当前账号尚未完成验证");
        }
        if ("locked".equals(user.status())) {
            if (user.lockedUntil() != null && user.lockedUntil().isAfter(now)) {
                throw new ApiException(HttpStatus.LOCKED, "USER_LOCKED", "登录失败次数过多，请稍后再试");
            }
            identityStore.unlockUser(user.id(), now);
        }
    }

    public sealed interface LoginDecision permits InvalidCredentials, LoginSucceeded, SelectionRequired {
    }

    public record InvalidCredentials(UUID userId) implements LoginDecision {
    }

    public record LoginSucceeded(AuthService.AuthenticatedSession session) implements LoginDecision {
    }

    public record SelectionRequired(AuthService.TenantSelectionRequired selection) implements LoginDecision {
    }
}
