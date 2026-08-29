package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionDetailResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderPageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ModelCatalogRepository;
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

class ModelCatalogQueryServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T05:00:00Z");

    private final ModelCatalogRepository repository = mock(ModelCatalogRepository.class);
    private final ModelCatalogQueryServiceImpl service = new ModelCatalogQueryServiceImpl(repository);

    @Test
    void providersMapsRepositoryPageAndCalculatesTotalPages() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.read"));
        UUID providerId = UUID.randomUUID();
        when(repository.findProviders(20, 20)).thenReturn(new ModelCatalogRepository.ProviderPage(
                List.of(new ModelCatalogRepository.ProviderRow(
                        providerId,
                        "lingzhen",
                        "灵帧平台",
                        "openai_compatible",
                        "平台模型",
                        "active",
                        NOW,
                        NOW,
                        3
                )),
                41
        ));

        ModelProviderPageResponse response = service.providers(context, 2, 20);

        assertThat(response.totalPages()).isEqualTo(3);
        assertThat(response.items()).singleElement().satisfies(item -> {
            assertThat(item.id()).isEqualTo(providerId);
            assertThat(item.code()).isEqualTo("lingzhen");
            assertThat(item.rowVersion()).isEqualTo(3);
        });
    }

    @Test
    void modelsNormalizesAllFiltersBeforeRepositoryAccess() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.read"));
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        when(repository.findModels("Seedance", "active", "video", providerId, 0, 50))
                .thenReturn(new ModelCatalogRepository.ModelPage(
                        List.of(new ModelCatalogRepository.ModelRow(
                                modelId,
                                providerId,
                                "doubao",
                                "豆包",
                                "seedance-2-mini",
                                "Seedance 2.0 Mini",
                                "video",
                                "视频生成模型",
                                Map.of("type", "object"),
                                Map.of("duration", 10),
                                true,
                                10,
                                "active",
                                NOW,
                                NOW,
                                2
                        )),
                        1
                ));

        ModelPageResponse response = service.models(
                context,
                1,
                50,
                "  Seedance  ",
                "ACTIVE",
                "VIDEO",
                providerId
        );

        assertThat(response.total()).isEqualTo(1);
        assertThat(response.items()).singleElement().satisfies(item -> {
            assertThat(item.id()).isEqualTo(modelId);
            assertThat(item.provider().id()).isEqualTo(providerId);
            assertThat(item.capabilityType()).isEqualTo("video");
        });
    }

    @Test
    void versionMapsImmutableSnapshot() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.read"));
        UUID versionId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        ModelCatalogRepository.VersionRow version = new ModelCatalogRepository.VersionRow(
                versionId,
                7,
                true,
                "a".repeat(64),
                context.userId(),
                context.membershipId(),
                NOW,
                NOW.minusSeconds(60),
                1
        );
        when(repository.findVersion(versionId)).thenReturn(Optional.of(
                new ModelCatalogRepository.VersionDetail(
                        version,
                        List.of(new ModelCatalogRepository.VersionModelRow(
                                modelId,
                                providerId,
                                "lingzhen",
                                "灵帧平台",
                                "openai_compatible",
                                "video-v1",
                                "视频模型",
                                "video",
                                null,
                                Map.of("type", "object"),
                                Map.of(),
                                false,
                                0
                        ))
                )
        ));

        CatalogVersionDetailResponse response = service.version(context, versionId);

        assertThat(response.version()).isEqualTo(7);
        assertThat(response.models()).singleElement().satisfies(item -> {
            assertThat(item.id()).isEqualTo(modelId);
            assertThat(item.provider().protocolFamily()).isEqualTo("openai_compatible");
        });
    }

    @Test
    void rejectsDesktopSessionBeforeRepositoryAccess() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("model_catalog.read"));

        assertApiError(() -> service.providers(context, 1, 20), 403, "MODEL_CATALOG_READ_FORBIDDEN");

        verify(repository, never()).findProviders(0, 20);
    }

    @Test
    void rejectsInvalidPaginationKeywordStatusAndCapability() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.read"));

        assertApiError(() -> service.providers(context, 0, 20), 400, "INVALID_PAGE_REQUEST");
        assertApiError(() -> service.models(context, 1, 101, null, "all", "all", null),
                400, "INVALID_PAGE_REQUEST");
        assertApiError(() -> service.models(context, 1, 20, "x".repeat(101), "all", "all", null),
                400, "SEARCH_KEYWORD_TOO_LONG");
        assertApiError(() -> service.models(context, 1, 20, null, "deleted", "all", null),
                400, "INVALID_MODEL_STATUS");
        assertApiError(() -> service.models(context, 1, 20, null, "all", "robot", null),
                400, "INVALID_MODEL_CAPABILITY");
    }

    @Test
    void returnsNotFoundForUnknownPublishedVersion() {
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.read"));
        UUID versionId = UUID.randomUUID();
        when(repository.findVersion(versionId)).thenReturn(Optional.empty());

        assertApiError(() -> service.version(context, versionId),
                404, "MODEL_CATALOG_VERSION_NOT_FOUND");
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "catalog_user",
                "catalog@example.com",
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
