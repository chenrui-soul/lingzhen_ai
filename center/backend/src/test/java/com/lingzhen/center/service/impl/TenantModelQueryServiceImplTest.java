package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelListResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.TenantModelRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
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

class TenantModelQueryServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T05:00:00Z");

    private final TenantModelRepository repository = mock(TenantModelRepository.class);
    private final TenantModelQueryServiceImpl service = new TenantModelQueryServiceImpl(repository);

    @Test
    void returnsUnavailableWhenNoCatalogHasBeenPublished() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("tenant_model.read"));
        when(repository.findCurrentCatalog(context.tenantId(), false)).thenReturn(Optional.empty());

        TenantModelListResponse response = service.models(context);

        assertThat(response.available()).isFalse();
        assertThat(response.catalogVersion()).isNull();
        assertThat(response.models()).isEmpty();
    }

    @Test
    void mapsCurrentTenantPoliciesWithoutFilteringDisabledModels() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("tenant_model.read"));
        UUID modelId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        UUID policyId = UUID.randomUUID();
        when(repository.findCurrentCatalog(context.tenantId(), false)).thenReturn(Optional.of(
                new TenantModelRepository.TenantCatalog(
                        3,
                        NOW,
                        List.of(new TenantModelRepository.ModelRow(
                                policyId,
                                modelId,
                                providerId,
                                "lingzhen",
                                "灵帧平台",
                                "video-v1",
                                "视频模型",
                                "video",
                                Map.of("type", "object"),
                                Map.of("duration", 10),
                                false,
                                "enabled",
                                true,
                                5L
                        ))
                )
        ));

        TenantModelListResponse response = service.models(context);

        assertThat(response.available()).isTrue();
        assertThat(response.catalogVersion()).isEqualTo(3);
        assertThat(response.models()).singleElement().satisfies(item -> {
            assertThat(item.policyId()).isEqualTo(policyId);
            assertThat(item.policy()).isEqualTo("enabled");
            assertThat(item.effectiveEnabled()).isTrue();
        });
    }

    @Test
    void rejectsDesktopSessionBeforeTenantRepositoryAccess() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("tenant_model.read"));

        assertThatThrownBy(() -> service.models(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(403);
                    assertThat(exception.code()).isEqualTo("TENANT_MODEL_READ_FORBIDDEN");
                });

        verify(repository, never()).findCurrentCatalog(context.tenantId(), false);
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "tenant_user",
                "tenant@example.com",
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
}
