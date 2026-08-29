package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.dto.auth.LoginRequest;
import com.lingzhen.center.model.dto.auth.SelectTenantRequest;
import com.lingzhen.center.model.dto.auth.TenantMembershipView;
import com.lingzhen.center.repository.AuthIdentityStore;
import com.lingzhen.center.security.AccessTokenIssuer;
import com.lingzhen.center.security.PasswordHasher;
import com.lingzhen.center.security.SecureTokenGenerator;
import com.lingzhen.center.service.AuthService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.UUID;

@Service
public class AuthServiceImpl implements AuthService {

    private final AuthIdentityStore identityStore;
    private final PasswordHasher passwordHasher;
    private final SecureTokenGenerator tokenGenerator;
    private final AccessTokenIssuer accessTokenIssuer;
    private final SessionCreationService sessionCreationService;
    private final LoginTransactionService loginTransactionService;
    private final LoginFailureService loginFailureService;
    private final RefreshTransactionService refreshTransactionService;
    private final TokenReplayService tokenReplayService;
    private final Clock clock;

    public AuthServiceImpl(
            AuthIdentityStore identityStore,
            PasswordHasher passwordHasher,
            SecureTokenGenerator tokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            SessionCreationService sessionCreationService,
            LoginTransactionService loginTransactionService,
            LoginFailureService loginFailureService,
            RefreshTransactionService refreshTransactionService,
            TokenReplayService tokenReplayService,
            Clock clock
    ) {
        this.identityStore = identityStore;
        this.passwordHasher = passwordHasher;
        this.tokenGenerator = tokenGenerator;
        this.accessTokenIssuer = accessTokenIssuer;
        this.sessionCreationService = sessionCreationService;
        this.loginTransactionService = loginTransactionService;
        this.loginFailureService = loginFailureService;
        this.refreshTransactionService = refreshTransactionService;
        this.tokenReplayService = tokenReplayService;
        this.clock = clock;
    }

    @Override
    @Transactional
    public AuthenticatedSession register(RegisterRequest request, RequestMetadata metadata) {
        String username = request.username().trim();
        String email = normalize(request.email());
        if (identityStore.usernameExists(username) || identityStore.emailExists(email)) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "AUTH_IDENTITY_EXISTS",
                    "用户名或邮箱已存在"
            );
        }

        Instant now = clock.instant();
        AuthIdentityStore.Invitation invitation = loadInvitation(request.invitationToken(), email, now);
        UUID userId = UUID.randomUUID();
        identityStore.createUser(new AuthIdentityStore.NewUser(
                userId,
                username,
                email,
                passwordHasher.hash(request.password()),
                now
        ));

        UUID membershipId;
        if (invitation == null) {
            AuthIdentityStore.Role owner = identityStore.requireRole("owner");
            UUID tenantId = UUID.randomUUID();
            identityStore.createTenant(new AuthIdentityStore.NewTenant(
                    tenantId,
                    personalTenantCode(),
                    username + " 的空间",
                    now
            ));
            membershipId = UUID.randomUUID();
            identityStore.createMembership(new AuthIdentityStore.NewMembership(
                    membershipId,
                    tenantId,
                    userId,
                    owner.id(),
                    now
            ));
        } else {
            membershipId = UUID.randomUUID();
            identityStore.createMembership(new AuthIdentityStore.NewMembership(
                    membershipId,
                    invitation.tenantId(),
                    userId,
                    invitation.roleId(),
                    now
            ));
            identityStore.acceptInvitation(invitation.id(), membershipId, now);
        }

        List<TenantMembershipView> memberships = identityStore.findActiveMemberships(userId);
        TenantMembershipView membership = memberships.stream()
                .filter(candidate -> candidate.id().equals(membershipId))
                .findFirst()
                .orElseThrow(() -> new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVITATION_INVALID",
                        "邀请对应的租户当前不可用"
                ));
        identityStore.recordSuccessfulLogin(userId, now);
        return sessionCreationService.create(
                userId,
                membership,
                request.clientType(),
                request.device(),
                metadata,
                now
        );
    }

    @Override
    public LoginOutcome login(LoginRequest request, RequestMetadata metadata) {
        LoginTransactionService.LoginDecision decision =
                loginTransactionService.authenticate(request, metadata);
        if (decision instanceof LoginTransactionService.InvalidCredentials invalid) {
            if (invalid.userId() != null) {
                loginFailureService.recordFailure(invalid.userId());
            }
            throw new ApiException(
                    HttpStatus.UNAUTHORIZED,
                    "AUTH_INVALID_CREDENTIALS",
                    "用户名、邮箱或密码错误"
            );
        }
        if (decision instanceof LoginTransactionService.LoginSucceeded succeeded) {
            return succeeded.session();
        }
        return ((LoginTransactionService.SelectionRequired) decision).selection();
    }

    @Override
    @Transactional
    public AuthenticatedSession selectTenant(SelectTenantRequest request, RequestMetadata metadata) {
        Instant now = clock.instant();
        AuthIdentityStore.TenantSelectionTicket ticket = identityStore
                .findTenantSelectionTicketForUpdate(tokenGenerator.hash(request.tenantSelectionTicket()))
                .orElseThrow(this::invalidTenantSelection);
        if (!"pending".equals(ticket.status()) || !ticket.expiresAt().isAfter(now)) {
            throw invalidTenantSelection();
        }
        if (!ticket.deviceHash().equals(request.device().deviceHash())
                || ticket.fingerprintVersion() != (short) request.device().fingerprintVersion()) {
            throw new ApiException(
                    HttpStatus.UNAUTHORIZED,
                    "TENANT_SELECTION_DEVICE_MISMATCH",
                    "租户选择票据与当前设备不匹配"
            );
        }

        AuthIdentityStore.UserAccount user = identityStore.findUser(ticket.userId())
                .filter(candidate -> "active".equals(candidate.status()))
                .orElseThrow(this::invalidTenantSelection);
        TenantMembershipView membership = identityStore
                .findTicketMembership(ticket.id(), request.tenantId())
                .orElseThrow(this::invalidTenantSelection);
        identityStore.consumeTenantSelectionTicket(ticket.id(), now);
        return sessionCreationService.create(
                user.id(),
                membership,
                ticket.clientType(),
                request.device(),
                metadata,
                now
        );
    }

    @Override
    public AuthenticatedSession refresh(String rawRefreshToken) {
        if (rawRefreshToken == null || rawRefreshToken.isBlank()) {
            throw invalidRefresh();
        }
        RefreshTransactionService.RefreshDecision decision =
                refreshTransactionService.rotate(rawRefreshToken.trim());
        if (decision instanceof RefreshTransactionService.ReplayDetected replay) {
            tokenReplayService.revokeFamily(replay.tokenId(), replay.familyId(), replay.sessionId());
            throw new ApiException(
                    HttpStatus.UNAUTHORIZED,
                    "REFRESH_TOKEN_REUSED",
                    "检测到 Refresh Token 重放，当前会话已撤销"
            );
        }
        if (decision == RefreshTransactionService.InvalidRefresh.INSTANCE) {
            throw invalidRefresh();
        }

        RefreshTransactionService.RefreshSucceeded succeeded =
                (RefreshTransactionService.RefreshSucceeded) decision;
        Instant now = clock.instant();
        AccessTokenIssuer.IssuedAccessToken accessToken =
                accessTokenIssuer.issue(succeeded.access(), now);
        return new AuthenticatedSession(
                succeeded.access(),
                accessToken.value(),
                accessToken.expiresAt(),
                succeeded.refreshToken(),
                succeeded.refreshTokenExpiresAt()
        );
    }

    @Override
    @Transactional
    public void logout(UUID sessionId) {
        Instant now = clock.instant();
        identityStore.revokeSessionRefreshTokens(sessionId, now, "user_logout");
        identityStore.revokeSession(sessionId, now, "user_logout");
    }

    private AuthIdentityStore.Invitation loadInvitation(
            String rawInvitationToken,
            String email,
            Instant now
    ) {
        if (rawInvitationToken == null || rawInvitationToken.isBlank()) {
            return null;
        }
        AuthIdentityStore.Invitation invitation = identityStore
                .findInvitationForUpdate(tokenGenerator.hash(rawInvitationToken.trim()))
                .orElseThrow(this::invalidInvitation);
        if (!"pending".equals(invitation.status()) || !invitation.expiresAt().isAfter(now)) {
            throw invalidInvitation();
        }
        if (invitation.targetEmail() != null
                && !normalize(invitation.targetEmail()).equals(email)) {
            throw invalidInvitation();
        }
        return invitation;
    }

    private ApiException invalidInvitation() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVITATION_INVALID",
                "邀请码无效、已使用或已过期"
        );
    }

    private ApiException invalidTenantSelection() {
        return new ApiException(
                HttpStatus.UNAUTHORIZED,
                "TENANT_SELECTION_INVALID",
                "租户选择票据无效或已过期"
        );
    }

    private ApiException invalidRefresh() {
        return new ApiException(
                HttpStatus.UNAUTHORIZED,
                "REFRESH_TOKEN_INVALID",
                "Refresh Token 无效或已过期"
        );
    }

    private String normalize(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }

    private String personalTenantCode() {
        return "personal_" + UUID.randomUUID().toString().replace("-", "").substring(0, 20);
    }
}
