package com.lingzhen.center.integration;

import com.lingzhen.center.repository.ManagementReadRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

@SpringBootTest
class ManagementReadPersistenceAdapterIntegrationTest extends PostgreSqlIdentityTestSupport {

    @Autowired
    private ManagementReadRepository repository;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Test
    void dashboardUsersAndTenantAreStrictlyIsolatedByTenantId() {
        Instant now = Instant.now().truncatedTo(ChronoUnit.SECONDS);
        UUID ownerRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'owner'",
                UUID.class
        );
        UUID memberRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'member'",
                UUID.class
        );
        TenantFixture first = createTenant("wave2_first", "Wave 2 第一租户");
        TenantFixture second = createTenant("wave2_second", "Wave 2 第二租户");

        MemberFixture firstOwner = createMember(first.id(), ownerRoleId, "Alice", "alice@wave2.test", "active", now);
        MemberFixture firstSuspended = createMember(
                first.id(), memberRoleId, "Bob_100%", "bob@wave2.test", "suspended", now
        );
        MemberFixture crossTenant = createMember(
                second.id(), ownerRoleId, "CrossTenant", "cross@wave2.test", "active", now
        );
        createActiveSession(first, firstOwner, now.plus(1, ChronoUnit.HOURS));

        ManagementReadRepository.DashboardSnapshot dashboard = repository.findDashboard(first.id(), now).orElseThrow();
        assertThat(dashboard.tenantName()).isEqualTo("Wave 2 第一租户");
        assertThat(dashboard.totalMembers()).isEqualTo(2);
        assertThat(dashboard.activeMembers()).isEqualTo(1);
        assertThat(dashboard.suspendedMembers()).isEqualTo(1);
        assertThat(dashboard.activeSessions()).isEqualTo(1);
        assertThat(dashboard.roles()).extracting(ManagementReadRepository.RoleCount::code)
                .containsExactlyInAnyOrder("owner", "member");

        ManagementReadRepository.MemberPage firstPage = repository.findMembers(
                first.id(), null, null, 0, 20, now
        );
        assertThat(firstPage.total()).isEqualTo(2);
        assertThat(firstPage.items()).extracting(ManagementReadRepository.MemberRow::username)
                .containsExactlyInAnyOrder(firstOwner.username(), firstSuspended.username());
        assertThat(firstPage.items()).noneMatch(item -> item.username().equals(crossTenant.username()));

        ManagementReadRepository.MemberPage literalWildcardSearch = repository.findMembers(
                first.id(), "_100%", null, 0, 20, now
        );
        assertThat(literalWildcardSearch.items()).extracting(ManagementReadRepository.MemberRow::username)
                .containsExactly(firstSuspended.username());

        ManagementReadRepository.MemberPage suspended = repository.findMembers(
                first.id(), null, "suspended", 0, 20, now
        );
        assertThat(suspended.total()).isEqualTo(1);
        assertThat(suspended.items().getFirst().membershipStatus()).isEqualTo("suspended");

        ManagementReadRepository.TenantSnapshot tenant = repository.findTenant(first.id(), now).orElseThrow();
        assertThat(tenant.totalMembers()).isEqualTo(2);
        assertThat(tenant.activeSessions()).isEqualTo(1);
    }

    private TenantFixture createTenant(String prefix, String displayName) {
        UUID id = UUID.randomUUID();
        String code = prefix + '_' + id.toString().replace("-", "").substring(0, 8);
        jdbcTemplate.update(
                "INSERT INTO identity.tenants (id, tenant_code, display_name) VALUES (?, ?, ?)",
                id,
                code,
                displayName
        );
        return new TenantFixture(id, code);
    }

    private MemberFixture createMember(
            UUID tenantId,
            UUID roleId,
            String username,
            String email,
            String membershipStatus,
            Instant now
    ) {
        UUID userId = UUID.randomUUID();
        UUID membershipId = UUID.randomUUID();
        String uniqueUsername = username + '_' + userId.toString().substring(0, 6);
        String uniqueEmail = userId.toString().substring(0, 8) + '_' + email;
        jdbcTemplate.update("""
                        INSERT INTO identity.users
                            (id, username, email, password_hash, status, last_login_at)
                        VALUES (?, ?, ?, 'integration-test-hash', 'active', ?)
                        """,
                userId,
                uniqueUsername,
                uniqueEmail,
                Timestamp.from(now.minus(10, ChronoUnit.MINUTES))
        );
        jdbcTemplate.update("""
                        INSERT INTO identity.tenant_memberships
                            (id, tenant_id, user_id, role_id, status, joined_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                membershipId,
                tenantId,
                userId,
                roleId,
                membershipStatus,
                Timestamp.from(now.minus(1, ChronoUnit.DAYS))
        );
        return new MemberFixture(membershipId, userId, uniqueUsername);
    }

    private void createActiveSession(TenantFixture tenant, MemberFixture member, Instant expiresAt) {
        UUID deviceId = UUID.randomUUID();
        jdbcTemplate.update("""
                        INSERT INTO identity.devices
                            (id, tenant_id, client_type, device_hash, fingerprint_version)
                        VALUES (?, ?, 'management_web', ?, 1)
                        """,
                deviceId,
                tenant.id(),
                member.userId().toString().replace("-", "") + "0".repeat(32)
        );
        jdbcTemplate.update("""
                        INSERT INTO identity.user_sessions
                            (id, user_id, tenant_id, membership_id, device_id, client_type, expires_at)
                        VALUES (?, ?, ?, ?, ?, 'management_web', ?)
                        """,
                UUID.randomUUID(),
                member.userId(),
                tenant.id(),
                member.membershipId(),
                deviceId,
                Timestamp.from(expiresAt)
        );
    }

    private record TenantFixture(UUID id, String code) {
    }

    private record MemberFixture(UUID membershipId, UUID userId, String username) {
    }
}
