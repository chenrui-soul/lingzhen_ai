package com.lingzhen.center.repository;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.auth.TenantMembershipView;
import com.lingzhen.center.model.enums.ClientType;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface AuthIdentityStore {

    boolean usernameExists(String username);

    boolean emailExists(String email);

    Optional<UserAccount> findUserByLoginForUpdate(String login);

    Optional<UserAccount> findUser(UUID userId);

    Optional<UserAccount> findUserForUpdate(UUID userId);

    UUID createUser(NewUser user);

    void recordSuccessfulLogin(UUID userId, Instant now);

    void recordFailedLogin(UUID userId, int failureCount, Instant lockedUntil, Instant now);

    void unlockUser(UUID userId, Instant now);

    Role requireRole(String code);

    UUID createTenant(NewTenant tenant);

    UUID createMembership(NewMembership membership);

    Optional<Invitation> findInvitationForUpdate(byte[] tokenHash);

    void acceptInvitation(UUID invitationId, UUID membershipId, Instant now);

    List<TenantMembershipView> findActiveMemberships(UUID userId);

    Device registerOrUpdateDevice(DeviceRegistration registration, Instant now);

    UUID createSession(NewSession session);

    void extendSession(UUID sessionId, Instant expiresAt, Instant now);

    void createRefreshToken(NewRefreshToken refreshToken);

    UUID createTenantSelectionTicket(
            NewTenantSelectionTicket ticket,
            List<TenantMembershipView> memberships
    );

    Optional<TenantSelectionTicket> findTenantSelectionTicketForUpdate(byte[] tokenHash);

    Optional<TenantMembershipView> findTicketMembership(UUID ticketId, UUID tenantId);

    void consumeTenantSelectionTicket(UUID ticketId, Instant now);

    Optional<RefreshToken> findRefreshTokenForUpdate(byte[] tokenHash);

    void rotateRefreshToken(UUID tokenId, Instant consumedAt, NewRefreshToken replacement);

    void markRefreshTokenReused(UUID tokenId, Instant now, String reason);

    void revokeRefreshFamily(UUID familyId, Instant now, String reason);

    void revokeSession(UUID sessionId, Instant now, String reason);

    void revokeSessionRefreshTokens(UUID sessionId, Instant now, String reason);

    void revokeUserSessions(UUID userId, Instant now, String reason);

    Optional<SessionContext> findSessionAccess(UUID sessionId, Instant now);

    record NewUser(
            UUID id,
            String username,
            String email,
            String passwordHash,
            Instant now
    ) {
    }

    record UserAccount(
            UUID id,
            String username,
            String email,
            String passwordHash,
            String status,
            int failedLoginCount,
            Instant lockedUntil
    ) {
    }

    record Role(UUID id, String code, String roleScope) {
    }

    record NewTenant(
            UUID id,
            String tenantCode,
            String displayName,
            Instant now
    ) {
    }

    record NewMembership(
            UUID id,
            UUID tenantId,
            UUID userId,
            UUID roleId,
            Instant now
    ) {
    }

    record Invitation(
            UUID id,
            UUID tenantId,
            String targetEmail,
            UUID roleId,
            String status,
            Instant expiresAt
    ) {
    }

    record DeviceRegistration(
            UUID tenantId,
            ClientType clientType,
            String deviceHash,
            short fingerprintVersion,
            String displayName,
            String platform,
            String architecture,
            String appVersion
    ) {
    }

    record Device(UUID id, String trustStatus) {
    }

    record NewSession(
            UUID id,
            UUID userId,
            UUID tenantId,
            UUID membershipId,
            UUID deviceId,
            ClientType clientType,
            Instant issuedAt,
            Instant expiresAt,
            String userAgent
    ) {
    }

    record NewRefreshToken(
            UUID id,
            UUID sessionId,
            UUID familyId,
            UUID parentTokenId,
            byte[] tokenHash,
            Instant issuedAt,
            Instant expiresAt
    ) {
    }

    record NewTenantSelectionTicket(
            UUID id,
            UUID userId,
            byte[] tokenHash,
            String deviceHash,
            short fingerprintVersion,
            ClientType clientType,
            Instant expiresAt,
            Instant now
    ) {
    }

    record TenantSelectionTicket(
            UUID id,
            UUID userId,
            String deviceHash,
            short fingerprintVersion,
            ClientType clientType,
            String status,
            Instant expiresAt
    ) {
    }

    record RefreshToken(
            UUID id,
            UUID sessionId,
            UUID familyId,
            String status,
            Instant expiresAt
    ) {
    }

}
