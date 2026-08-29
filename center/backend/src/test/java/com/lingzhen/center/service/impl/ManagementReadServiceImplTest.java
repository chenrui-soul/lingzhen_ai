package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.management.ManagementDashboardResponse;
import com.lingzhen.center.model.dto.management.ManagementUserPageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ManagementReadRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ManagementReadServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T03:00:00Z");

    private final ManagementReadRepository repository = mock(ManagementReadRepository.class);
    private final ManagementReadServiceImpl service = new ManagementReadServiceImpl(
            repository,
            Clock.fixed(NOW, ZoneOffset.UTC)
    );

    @Test
    void dashboardMapsCurrentTenantSnapshot() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("tenant.read"));
        when(repository.findDashboard(context.tenantId(), NOW)).thenReturn(Optional.of(
                new ManagementReadRepository.DashboardSnapshot(
                        context.tenantId(),
                        "tenant_alpha",
                        "Alpha 工作空间",
                        "active",
                        8,
                        6,
                        1,
                        3,
                        List.of(new ManagementReadRepository.RoleCount("owner", "所有者", 1))
                )
        ));

        ManagementDashboardResponse response = service.dashboard(context);

        assertThat(response.generatedAt()).isEqualTo(NOW);
        assertThat(response.tenant().id()).isEqualTo(context.tenantId());
        assertThat(response.metrics().totalMembers()).isEqualTo(8);
        assertThat(response.metrics().activeSessions()).isEqualTo(3);
        assertThat(response.roles()).singleElement().satisfies(role -> {
            assertThat(role.code()).isEqualTo("owner");
            assertThat(role.members()).isEqualTo(1);
        });
    }

    @Test
    void usersNormalizesFiltersAndCalculatesTotalPages() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("membership.read"));
        when(repository.findMembers(context.tenantId(), "Alice", "active", 20, 20, NOW))
                .thenReturn(new ManagementReadRepository.MemberPage(List.of(), 41));

        ManagementUserPageResponse response = service.users(context, 2, 20, "  Alice  ", "ACTIVE");

        assertThat(response.page()).isEqualTo(2);
        assertThat(response.total()).isEqualTo(41);
        assertThat(response.totalPages()).isEqualTo(3);
    }

    @Test
    void managementReadRejectsDesktopSessionBeforeRepositoryAccess() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("tenant.read", "membership.read"));

        assertApiError(() -> service.dashboard(context), 403, "MANAGEMENT_READ_FORBIDDEN");

        verify(repository, never()).findDashboard(context.tenantId(), NOW);
    }

    @Test
    void managementReadRejectsMissingPermission() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of());

        assertApiError(() -> service.users(context, 1, 20, null, "all"),
                403, "MANAGEMENT_READ_FORBIDDEN");
    }

    @Test
    void usersRejectsInvalidPagination() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("membership.read"));

        assertApiError(() -> service.users(context, 0, 20, null, "all"),
                400, "INVALID_PAGE_REQUEST");
        assertApiError(() -> service.users(context, 1, 101, null, "all"),
                400, "INVALID_PAGE_REQUEST");
    }

    @Test
    void usersRejectsUnknownStatus() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("membership.read"));

        assertApiError(() -> service.users(context, 1, 20, null, "deleted"),
                400, "INVALID_MEMBER_STATUS");
    }

    @Test
    void usersRejectsKeywordLongerThanOneHundredCharacters() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("membership.read"));

        assertApiError(() -> service.users(context, 1, 20, "x".repeat(101), "all"),
                400, "SEARCH_KEYWORD_TOO_LONG");
    }

    @Test
    void tenantReturnsNotFoundWhenCurrentTenantNoLongerExists() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("tenant.read"));
        when(repository.findTenant(context.tenantId(), NOW)).thenReturn(Optional.empty());

        assertApiError(() -> service.tenant(context), 404, "TENANT_NOT_FOUND");
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "management_user",
                "management@example.com",
                UUID.randomUUID(),
                "tenant_alpha",
                "Alpha 工作空间",
                UUID.randomUUID(),
                UUID.randomUUID(),
                clientType,
                "owner",
                permissions,
                Map.of(),
                NOW.plusSeconds(900)
        );
    }

    private void assertApiError(Runnable action, int status, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(status);
                    assertThat(exception.code()).isEqualTo(code);
                });
    }
}
