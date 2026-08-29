package com.lingzhen.center.repository;

import com.lingzhen.center.model.entity.DeviceEntity;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.auth.TenantMembershipView;
import com.lingzhen.center.model.entity.RefreshTokenEntity;
import com.lingzhen.center.model.entity.RoleEntity;
import com.lingzhen.center.model.entity.TenantEntity;
import com.lingzhen.center.model.entity.TenantInvitationEntity;
import com.lingzhen.center.model.entity.TenantMembershipEntity;
import com.lingzhen.center.model.entity.TenantSelectionTicketEntity;
import com.lingzhen.center.model.entity.UserEntity;
import com.lingzhen.center.model.entity.UserSessionEntity;
import com.lingzhen.center.model.enums.ClientType;
import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;
import jakarta.persistence.NoResultException;
import org.springframework.stereotype.Repository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Repository
public class IdentityPersistenceAdapter implements AuthIdentityStore {

    private final EntityManager entityManager;

    public IdentityPersistenceAdapter(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public boolean usernameExists(String username) {
        return existsByNormalizedColumn("username", username);
    }

    @Override
    public boolean emailExists(String email) {
        return existsByNormalizedColumn("email", email);
    }

    @Override
    public Optional<UserAccount> findUserByLoginForUpdate(String login) {
        String normalized = normalize(login);
        List<UserEntity> users = entityManager.createQuery("""
                        select u from UserEntity u
                        where lower(trim(u.username)) = :login
                           or lower(trim(u.email)) = :login
                        """, UserEntity.class)
                .setParameter("login", normalized)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        return users.stream().findFirst().map(this::toUserAccount);
    }

    @Override
    public Optional<UserAccount> findUser(UUID userId) {
        return Optional.ofNullable(entityManager.find(UserEntity.class, userId))
                .map(this::toUserAccount);
    }

    @Override
    public Optional<UserAccount> findUserForUpdate(UUID userId) {
        return Optional.ofNullable(entityManager.find(
                        UserEntity.class,
                        userId,
                        LockModeType.PESSIMISTIC_WRITE
                ))
                .map(this::toUserAccount);
    }

    @Override
    public UUID createUser(NewUser user) {
        UserEntity entity = new UserEntity(
                user.id(),
                user.username(),
                user.email(),
                user.passwordHash(),
                user.now()
        );
        entityManager.persist(entity);
        return entity.id();
    }

    @Override
    public void recordSuccessfulLogin(UUID userId, Instant now) {
        requireUser(userId).recordSuccessfulLogin(now);
    }

    @Override
    public void recordFailedLogin(UUID userId, int failureCount, Instant lockedUntil, Instant now) {
        requireUser(userId).recordFailedLogin(failureCount, lockedUntil, now);
    }

    @Override
    public void unlockUser(UUID userId, Instant now) {
        requireUser(userId).unlock(now);
    }

    @Override
    public Role requireRole(String code) {
        try {
            RoleEntity role = entityManager.createQuery(
                            "select r from RoleEntity r where r.code = :code",
                            RoleEntity.class
                    )
                    .setParameter("code", code)
                    .getSingleResult();
            return new Role(role.id(), role.code(), role.roleScope());
        } catch (NoResultException exception) {
            throw new IllegalStateException("Required system role is missing: " + code, exception);
        }
    }

    @Override
    public UUID createTenant(NewTenant tenant) {
        TenantEntity entity = new TenantEntity(
                tenant.id(),
                tenant.tenantCode(),
                tenant.displayName(),
                tenant.now()
        );
        entityManager.persist(entity);
        return entity.id();
    }

    @Override
    public UUID createMembership(NewMembership membership) {
        TenantMembershipEntity entity = new TenantMembershipEntity(
                membership.id(),
                membership.tenantId(),
                membership.userId(),
                membership.roleId(),
                membership.now()
        );
        entityManager.persist(entity);
        return entity.id();
    }

    @Override
    public Optional<Invitation> findInvitationForUpdate(byte[] tokenHash) {
        List<TenantInvitationEntity> invitations = entityManager.createQuery("""
                        select invitation from TenantInvitationEntity invitation
                        where invitation.tokenHash = :tokenHash
                        """, TenantInvitationEntity.class)
                .setParameter("tokenHash", tokenHash)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        return invitations.stream().findFirst().map(invitation -> new Invitation(
                invitation.id(),
                invitation.tenantId(),
                invitation.targetEmail(),
                invitation.roleId(),
                invitation.status(),
                invitation.expiresAt()
        ));
    }

    @Override
    public void acceptInvitation(UUID invitationId, UUID membershipId, Instant now) {
        TenantInvitationEntity invitation = entityManager.find(TenantInvitationEntity.class, invitationId);
        if (invitation == null) {
            throw new IllegalStateException("Invitation disappeared during registration");
        }
        invitation.accept(membershipId, now);
    }

    @Override
    public List<TenantMembershipView> findActiveMemberships(UUID userId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT m.id, m.tenant_id, t.tenant_code, t.display_name, t.status,
                               m.role_id, r.code, m.status
                        FROM identity.tenant_memberships m
                        JOIN identity.tenants t ON t.id = m.tenant_id
                        JOIN identity.roles r ON r.id = m.role_id
                        WHERE m.user_id = :userId
                          AND m.status = 'active'
                          AND t.status = 'active'
                        ORDER BY t.created_at, m.created_at
                        """)
                .setParameter("userId", userId)
                .getResultList();
        return rows.stream().map(this::toMembership).toList();
    }

    @Override
    public Device registerOrUpdateDevice(DeviceRegistration registration, Instant now) {
        List<DeviceEntity> devices = entityManager.createQuery("""
                        select d from DeviceEntity d
                        where d.tenantId = :tenantId
                          and d.clientType = :clientType
                          and d.deviceHash = :deviceHash
                        """, DeviceEntity.class)
                .setParameter("tenantId", registration.tenantId())
                .setParameter("clientType", registration.clientType().value())
                .setParameter("deviceHash", registration.deviceHash())
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();

        DeviceEntity device = devices.stream().findFirst().orElseGet(() -> {
            DeviceEntity created = new DeviceEntity(
                    UUID.randomUUID(),
                    registration.tenantId(),
                    registration.clientType().value(),
                    registration.deviceHash(),
                    registration.fingerprintVersion(),
                    registration.displayName(),
                    registration.platform(),
                    registration.architecture(),
                    registration.appVersion(),
                    now
            );
            entityManager.persist(created);
            return created;
        });

        if (!devices.isEmpty()) {
            device.seen(
                    registration.fingerprintVersion(),
                    registration.displayName(),
                    registration.platform(),
                    registration.architecture(),
                    registration.appVersion(),
                    now
            );
        }
        return new Device(device.id(), device.trustStatus());
    }

    @Override
    public UUID createSession(NewSession session) {
        UserSessionEntity entity = new UserSessionEntity(
                session.id(),
                session.userId(),
                session.tenantId(),
                session.membershipId(),
                session.deviceId(),
                session.clientType().value(),
                session.issuedAt(),
                session.expiresAt(),
                session.userAgent()
        );
        entityManager.persist(entity);
        return entity.id();
    }

    @Override
    public void extendSession(UUID sessionId, Instant expiresAt, Instant now) {
        UserSessionEntity session = entityManager.find(UserSessionEntity.class, sessionId);
        if (session == null) {
            throw new IllegalStateException("Session disappeared during refresh");
        }
        session.extend(expiresAt, now);
    }

    @Override
    public void createRefreshToken(NewRefreshToken refreshToken) {
        entityManager.persist(new RefreshTokenEntity(
                refreshToken.id(),
                refreshToken.sessionId(),
                refreshToken.familyId(),
                refreshToken.parentTokenId(),
                refreshToken.tokenHash(),
                refreshToken.issuedAt(),
                refreshToken.expiresAt()
        ));
    }

    @Override
    public UUID createTenantSelectionTicket(
            NewTenantSelectionTicket ticket,
            List<TenantMembershipView> memberships
    ) {
        TenantSelectionTicketEntity entity = new TenantSelectionTicketEntity(
                ticket.id(),
                ticket.userId(),
                ticket.tokenHash(),
                ticket.deviceHash(),
                ticket.fingerprintVersion(),
                ticket.clientType().value(),
                ticket.expiresAt(),
                ticket.now()
        );
        entityManager.persist(entity);
        entityManager.flush();
        for (TenantMembershipView membership : memberships) {
            entityManager.createNativeQuery("""
                            INSERT INTO identity.tenant_selection_ticket_memberships
                                (ticket_id, user_id, membership_id, tenant_id, created_at)
                            VALUES (:ticketId, :userId, :membershipId, :tenantId, :createdAt)
                            """)
                    .setParameter("ticketId", ticket.id())
                    .setParameter("userId", ticket.userId())
                    .setParameter("membershipId", membership.id())
                    .setParameter("tenantId", membership.tenantId())
                    .setParameter("createdAt", ticket.now())
                    .executeUpdate();
        }
        return entity.id();
    }

    @Override
    public Optional<TenantSelectionTicket> findTenantSelectionTicketForUpdate(byte[] tokenHash) {
        List<TenantSelectionTicketEntity> tickets = entityManager.createQuery("""
                        select ticket from TenantSelectionTicketEntity ticket
                        where ticket.tokenHash = :tokenHash
                        """, TenantSelectionTicketEntity.class)
                .setParameter("tokenHash", tokenHash)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        return tickets.stream().findFirst().map(ticket -> new TenantSelectionTicket(
                ticket.id(),
                ticket.userId(),
                ticket.deviceHash(),
                ticket.fingerprintVersion(),
                ClientType.fromValue(ticket.clientType()),
                ticket.status(),
                ticket.expiresAt()
        ));
    }

    @Override
    public Optional<TenantMembershipView> findTicketMembership(UUID ticketId, UUID tenantId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT m.id, m.tenant_id, t.tenant_code, t.display_name, t.status,
                               m.role_id, r.code, m.status
                        FROM identity.tenant_selection_ticket_memberships candidate
                        JOIN identity.tenant_memberships m ON m.id = candidate.membership_id
                        JOIN identity.tenants t ON t.id = m.tenant_id
                        JOIN identity.roles r ON r.id = m.role_id
                        WHERE candidate.ticket_id = :ticketId
                          AND candidate.tenant_id = :tenantId
                          AND m.status = 'active'
                          AND t.status = 'active'
                        """)
                .setParameter("ticketId", ticketId)
                .setParameter("tenantId", tenantId)
                .setMaxResults(1)
                .getResultList();
        return rows.stream().findFirst().map(this::toMembership);
    }

    @Override
    public void consumeTenantSelectionTicket(UUID ticketId, Instant now) {
        TenantSelectionTicketEntity ticket = entityManager.find(TenantSelectionTicketEntity.class, ticketId);
        if (ticket == null) {
            throw new IllegalStateException("Tenant selection ticket disappeared");
        }
        ticket.consume(now);
    }

    @Override
    public Optional<RefreshToken> findRefreshTokenForUpdate(byte[] tokenHash) {
        List<RefreshTokenEntity> tokens = entityManager.createQuery("""
                        select token from RefreshTokenEntity token
                        where token.tokenHash = :tokenHash
                        """, RefreshTokenEntity.class)
                .setParameter("tokenHash", tokenHash)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .setMaxResults(1)
                .getResultList();
        return tokens.stream().findFirst().map(this::toRefreshToken);
    }

    @Override
    public void rotateRefreshToken(UUID tokenId, Instant consumedAt, NewRefreshToken replacement) {
        RefreshTokenEntity current = entityManager.find(RefreshTokenEntity.class, tokenId);
        if (current == null) {
            throw new IllegalStateException("Refresh token disappeared during rotation");
        }
        current.rotate(consumedAt);
        entityManager.flush();
        createRefreshToken(replacement);
    }

    @Override
    public void markRefreshTokenReused(UUID tokenId, Instant now, String reason) {
        RefreshTokenEntity token = entityManager.find(RefreshTokenEntity.class, tokenId);
        if (token != null) {
            token.reuse(now, reason);
        }
    }

    @Override
    public void revokeRefreshFamily(UUID familyId, Instant now, String reason) {
        List<RefreshTokenEntity> tokens = entityManager.createQuery("""
                        select token from RefreshTokenEntity token
                        where token.familyId = :familyId
                        """, RefreshTokenEntity.class)
                .setParameter("familyId", familyId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        tokens.forEach(token -> token.revoke(now, reason));
    }

    @Override
    public void revokeSession(UUID sessionId, Instant now, String reason) {
        UserSessionEntity session = entityManager.find(UserSessionEntity.class, sessionId);
        if (session != null) {
            session.revoke(now, reason);
        }
    }

    @Override
    public void revokeSessionRefreshTokens(UUID sessionId, Instant now, String reason) {
        List<RefreshTokenEntity> tokens = entityManager.createQuery("""
                        select token from RefreshTokenEntity token
                        where token.sessionId = :sessionId and token.status = 'active'
                        """, RefreshTokenEntity.class)
                .setParameter("sessionId", sessionId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        tokens.forEach(token -> token.revoke(now, reason));
    }

    @Override
    public void revokeUserSessions(UUID userId, Instant now, String reason) {
        List<UserSessionEntity> sessions = entityManager.createQuery("""
                        select session from UserSessionEntity session
                        where session.userId = :userId and session.status = 'active'
                        """, UserSessionEntity.class)
                .setParameter("userId", userId)
                .setLockMode(LockModeType.PESSIMISTIC_WRITE)
                .getResultList();
        sessions.forEach(session -> session.revoke(now, reason));
    }

    @Override
    public Optional<SessionContext> findSessionAccess(UUID sessionId, Instant now) {
        UserSessionEntity session = entityManager.find(UserSessionEntity.class, sessionId);
        if (session == null || !"active".equals(session.status()) || !session.expiresAt().isAfter(now)) {
            return Optional.empty();
        }

        UserEntity user = entityManager.find(UserEntity.class, session.userId());
        TenantEntity tenant = entityManager.find(TenantEntity.class, session.tenantId());
        TenantMembershipEntity membership = entityManager.find(
                TenantMembershipEntity.class,
                session.membershipId()
        );
        DeviceEntity device = entityManager.find(DeviceEntity.class, session.deviceId());
        if (!validSessionBinding(session, user, tenant, membership, device)) {
            return Optional.empty();
        }

        RoleEntity role = entityManager.find(RoleEntity.class, membership.roleId());
        if (role == null) {
            return Optional.empty();
        }

        ClientType clientType = ClientType.fromValue(session.clientType());
        Set<String> permissions = loadPermissions(
                user.id(),
                tenant.id(),
                membership.id(),
                role.id(),
                clientType,
                now
        );
        Map<String, String> featurePolicies = loadFeaturePolicies(
                tenant.id(),
                membership.id(),
                now
        );
        return Optional.of(new SessionContext(
                session.id(),
                user.id(),
                user.username(),
                user.email(),
                tenant.id(),
                tenant.tenantCode(),
                tenant.displayName(),
                membership.id(),
                device.id(),
                clientType,
                role.code(),
                Set.copyOf(permissions),
                Map.copyOf(featurePolicies),
                session.expiresAt()
        ));
    }

    private boolean existsByNormalizedColumn(String column, String value) {
        if (value == null || value.isBlank()) {
            return false;
        }
        String sql = "username".equals(column)
                ? "select count(u) from UserEntity u where lower(trim(u.username)) = :value"
                : "select count(u) from UserEntity u where lower(trim(u.email)) = :value";
        Long count = entityManager.createQuery(sql, Long.class)
                .setParameter("value", normalize(value))
                .getSingleResult();
        return count > 0;
    }

    private UserEntity requireUser(UUID userId) {
        UserEntity user = entityManager.find(UserEntity.class, userId);
        if (user == null) {
            throw new IllegalStateException("User disappeared during authentication");
        }
        return user;
    }

    private UserAccount toUserAccount(UserEntity user) {
        return new UserAccount(
                user.id(),
                user.username(),
                user.email(),
                user.passwordHash(),
                user.status(),
                user.failedLoginCount(),
                user.lockedUntil()
        );
    }

    private TenantMembershipView toMembership(Object[] row) {
        return new TenantMembershipView(
                (UUID) row[0],
                (UUID) row[1],
                (String) row[2],
                (String) row[3],
                (String) row[4],
                (UUID) row[5],
                (String) row[6],
                (String) row[7]
        );
    }

    private RefreshToken toRefreshToken(RefreshTokenEntity token) {
        return new RefreshToken(
                token.id(),
                token.sessionId(),
                token.familyId(),
                token.status(),
                token.expiresAt()
        );
    }

    private boolean validSessionBinding(
            UserSessionEntity session,
            UserEntity user,
            TenantEntity tenant,
            TenantMembershipEntity membership,
            DeviceEntity device
    ) {
        return user != null
                && "active".equals(user.status())
                && tenant != null
                && "active".equals(tenant.status())
                && membership != null
                && "active".equals(membership.status())
                && membership.userId().equals(user.id())
                && membership.tenantId().equals(tenant.id())
                && device != null
                && !"blocked".equals(device.trustStatus())
                && device.tenantId().equals(tenant.id())
                && device.clientType().equals(session.clientType());
    }

    private Set<String> loadPermissions(
            UUID userId,
            UUID tenantId,
            UUID membershipId,
            UUID roleId,
            ClientType clientType,
            Instant now
    ) {
        Set<String> permissions = new HashSet<>(queryRolePermissions(roleId, clientType));
        if (clientType == ClientType.MANAGEMENT_WEB) {
            permissions.addAll(queryPlatformPermissions(userId));
        }

        @SuppressWarnings("unchecked")
        List<Object[]> overrides = entityManager.createNativeQuery("""
                        SELECT permission.code, override.effect
                        FROM identity.permission_overrides override
                        JOIN identity.permissions permission ON permission.id = override.permission_id
                        WHERE override.tenant_id = :tenantId
                          AND override.status = 'active'
                          AND override.valid_from <= :now
                          AND (override.valid_until IS NULL OR override.valid_until > :now)
                          AND permission.client_type = :clientType
                          AND (
                              override.target_scope = 'tenant'
                              OR (override.target_scope = 'membership'
                                  AND override.target_membership_id = :membershipId)
                          )
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("membershipId", membershipId)
                .setParameter("clientType", clientType.value())
                .setParameter("now", now)
                .getResultList();

        Set<String> denied = new HashSet<>();
        for (Object[] override : overrides) {
            String code = (String) override[0];
            String effect = (String) override[1];
            if ("deny".equals(effect)) {
                denied.add(code);
            } else if ("allow".equals(effect)) {
                permissions.add(code);
            }
        }
        permissions.removeAll(denied);
        return permissions;
    }

    private List<String> queryRolePermissions(UUID roleId, ClientType clientType) {
        @SuppressWarnings("unchecked")
        List<String> permissions = entityManager.createNativeQuery("""
                        SELECT permission.code
                        FROM identity.role_permissions role_permission
                        JOIN identity.permissions permission ON permission.id = role_permission.permission_id
                        WHERE role_permission.role_id = :roleId
                          AND permission.client_type = :clientType
                        """)
                .setParameter("roleId", roleId)
                .setParameter("clientType", clientType.value())
                .getResultList();
        return permissions;
    }

    private List<String> queryPlatformPermissions(UUID userId) {
        @SuppressWarnings("unchecked")
        List<String> permissions = entityManager.createNativeQuery("""
                        SELECT DISTINCT permission.code
                        FROM identity.platform_role_assignments assignment
                        JOIN identity.role_permissions role_permission
                          ON role_permission.role_id = assignment.role_id
                        JOIN identity.permissions permission
                          ON permission.id = role_permission.permission_id
                        WHERE assignment.user_id = :userId
                          AND assignment.status = 'active'
                          AND permission.client_type = 'management_web'
                        """)
                .setParameter("userId", userId)
                .getResultList();
        return permissions;
    }

    private Map<String, String> loadFeaturePolicies(UUID tenantId, UUID membershipId, Instant now) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT feature_code, effect, target_scope
                        FROM identity.feature_policies
                        WHERE tenant_id = :tenantId
                          AND status = 'active'
                          AND valid_from <= :now
                          AND (valid_until IS NULL OR valid_until > :now)
                          AND (
                              target_scope = 'tenant'
                              OR (target_scope = 'membership' AND target_membership_id = :membershipId)
                          )
                        ORDER BY CASE target_scope WHEN 'tenant' THEN 0 ELSE 1 END
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("membershipId", membershipId)
                .setParameter("now", now)
                .getResultList();
        Map<String, String> policies = new HashMap<>();
        rows.forEach(row -> policies.put((String) row[0], (String) row[1]));
        return policies;
    }

    private String normalize(String value) {
        return value.trim().toLowerCase(Locale.ROOT);
    }
}
