package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.config.PlatformProxyProperties;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopModelCatalogResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
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

class DesktopModelCatalogServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T05:00:00Z");

    private final TenantModelRepository repository = mock(TenantModelRepository.class);
    private final ModelRuntimeConfigRepository runtimeConfigs = mock(ModelRuntimeConfigRepository.class);
    private final PlatformProxyProperties properties = new PlatformProxyProperties();
    private final DesktopModelCatalogServiceImpl service = new DesktopModelCatalogServiceImpl(
            repository, properties, runtimeConfigs);

    @Test
    void loadReturnsOnlyEffectiveModelsForCurrentTenant() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("model.use"));
        UUID modelId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        when(repository.findCurrentCatalog(context.tenantId(), true)).thenReturn(Optional.of(
                new TenantModelRepository.TenantCatalog(
                        9,
                        NOW,
                        List.of(new TenantModelRepository.ModelRow(
                                UUID.randomUUID(),
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
                                1L
                        ))
                )
        ));

        DesktopModelCatalogResponse response = service.load(context);

        assertThat(response.modelCatalog().available()).isTrue();
        assertThat(response.modelCatalog().version()).isEqualTo(9);
        assertThat(response.models()).singleElement().satisfies(item -> {
            assertThat(item.id()).isEqualTo(modelId);
            assertThat(item.source()).isEqualTo("platform");
            assertThat(item.provider().id()).isEqualTo(providerId);
            assertThat(item.catalogVersion()).isEqualTo(9);
            assertThat(item.executionReady()).isFalse();
        });
    }

    @Test
    void bootstrapCanReadCatalogWithBootstrapPermissionOnly() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("desktop.bootstrap"));
        when(repository.findCurrentCatalog(context.tenantId(), true)).thenReturn(Optional.empty());

        DesktopModelCatalogResponse response = service.loadForBootstrap(context);

        assertThat(response.modelCatalog().available()).isFalse();
        assertThat(response.models()).isEmpty();
        verify(repository).findCurrentCatalog(context.tenantId(), true);
    }

    @Test
    void marksModelExecutableOnlyWhenBackendProviderIsConfigured() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("model.use"));
        UUID modelId = UUID.randomUUID();
        when(repository.findCurrentCatalog(context.tenantId(), true)).thenReturn(Optional.of(
                new TenantModelRepository.TenantCatalog(2, NOW, List.of(new TenantModelRepository.ModelRow(
                        null, modelId, UUID.randomUUID(), "lingzhen", "灵帧平台", "text-v1", "文本模型",
                        "text", Map.of(), Map.of(), true, "inherit", true, null
                )))
        ));
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(new ModelRuntimeConfigRepository.RuntimeConfigRow(
                modelId, "https://models.example.com", "ciphertext", "/v1/videos", "/v1/videos/{id}",
                null, 120, true, NOW, NOW, 0
        )));

        DesktopModelCatalogResponse response = new DesktopModelCatalogServiceImpl(repository, properties, runtimeConfigs).load(context);

        assertThat(response.models()).singleElement().extracting(item -> item.executionReady()).isEqualTo(true);
    }

    @Test
    void independentDesktopEndpointRequiresModelUsePermission() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("desktop.bootstrap"));

        assertThatThrownBy(() -> service.load(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(403);
                    assertThat(exception.code()).isEqualTo("DESKTOP_MODEL_READ_FORBIDDEN");
                });

        verify(repository, never()).findCurrentCatalog(context.tenantId(), true);
    }

    @Test
    void rejectsManagementSessionEvenWhenItCarriesDesktopPermissionText() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model.use"));

        assertThatThrownBy(() -> service.load(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(403);
                    assertThat(exception.code()).isEqualTo("DESKTOP_MODEL_READ_FORBIDDEN");
                });
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "desktop_user",
                "desktop@example.com",
                UUID.randomUUID(),
                "tenant_alpha",
                "Alpha 工作空间",
                UUID.randomUUID(),
                UUID.randomUUID(),
                clientType,
                "member",
                permissions,
                Map.of(),
                NOW.plusSeconds(900)
        );
    }
}
