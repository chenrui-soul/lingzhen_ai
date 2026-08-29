package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishPreviewResponse;
import com.lingzhen.center.model.dto.modelcatalog.PublishCatalogRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ModelCatalogRepository;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CatalogPublicationServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T08:00:00Z");

    private final ModelCatalogRepository repository = mock(ModelCatalogRepository.class);
    private final CatalogPublicationServiceImpl service = new CatalogPublicationServiceImpl(
            repository,
            new ObjectMapper(),
            Clock.fixed(NOW, ZoneOffset.UTC)
    );

    @Test
    void previewsAddedModifiedAndRemovedModelsWithoutExposingSnapshotDetails() {
        UUID retainedId = UUID.randomUUID();
        UUID removedId = UUID.randomUUID();
        UUID addedId = UUID.randomUUID();
        ModelCatalogRepository.VersionDetail current = versionDetail(
                4,
                "0".repeat(64),
                List.of(model(retainedId, "Old name", Map.of()), model(removedId, "Removed", Map.of()))
        );
        when(repository.findCurrentVersion()).thenReturn(Optional.of(current));
        when(repository.findPublishableModels()).thenReturn(List.of(
                model(retainedId, "New name", Map.of()),
                model(addedId, "Added", Map.of())
        ));
        when(repository.nextVersionNumber()).thenReturn(5L);

        var preview = service.preview(context(ClientType.MANAGEMENT_WEB, publishPermission()));

        assertThat(preview.currentVersion()).isEqualTo(4L);
        assertThat(preview.nextVersion()).isEqualTo(5L);
        assertThat(preview.modelCount()).isEqualTo(2);
        assertThat(preview.addedCount()).isEqualTo(1);
        assertThat(preview.modifiedCount()).isEqualTo(1);
        assertThat(preview.removedCount()).isEqualTo(1);
        assertThat(preview.canPublish()).isTrue();
        assertThat(preview.contentHash()).matches("[0-9a-f]{64}");
    }

    @Test
    void blocksEmptyPublicationAndDisablesPublishWhenNothingChanged() {
        when(repository.findCurrentVersion()).thenReturn(Optional.empty());
        when(repository.findPublishableModels()).thenReturn(List.of());
        when(repository.nextVersionNumber()).thenReturn(1L);

        var preview = service.preview(context(ClientType.MANAGEMENT_WEB, publishPermission()));

        assertThat(preview.hasChanges()).isFalse();
        assertThat(preview.canPublish()).isFalse();
        assertThat(preview.blockers())
                .extracting(CatalogPublishPreviewResponse.Blocker::code)
                .containsExactly("MODEL_CATALOG_EMPTY");
    }

    @Test
    void generatesStableHashWhenJsonObjectKeyOrderChanges() {
        UUID modelId = UUID.randomUUID();
        Map<String, Object> first = new LinkedHashMap<>();
        first.put("zeta", 1);
        first.put("alpha", Map.of("b", 2, "a", 1));
        Map<String, Object> second = new LinkedHashMap<>();
        second.put("alpha", Map.of("a", 1, "b", 2));
        second.put("zeta", 1);
        ModelCatalogRepository.VersionModelRow firstModel = model(modelId, "Model", first);
        ModelCatalogRepository.VersionModelRow secondModel = new ModelCatalogRepository.VersionModelRow(
                firstModel.modelId(),
                firstModel.providerId(),
                firstModel.providerCode(),
                firstModel.providerDisplayName(),
                firstModel.providerProtocolFamily(),
                firstModel.code(),
                firstModel.displayName(),
                firstModel.capabilityType(),
                firstModel.description(),
                second,
                firstModel.defaultParameters(),
                firstModel.defaultTenantEnabled(),
                firstModel.sortOrder()
        );
        when(repository.findCurrentVersion()).thenReturn(Optional.empty());
        when(repository.findPublishableModels()).thenReturn(
                List.of(firstModel),
                List.of(secondModel)
        );
        when(repository.nextVersionNumber()).thenReturn(1L);

        String firstHash = service.preview(context(
                ClientType.MANAGEMENT_WEB, publishPermission()
        )).contentHash();
        String secondHash = service.preview(context(
                ClientType.MANAGEMENT_WEB, publishPermission()
        )).contentHash();

        assertThat(secondHash).isEqualTo(firstHash);
    }

    @Test
    void publishesInTheRequiredTransactionalSequence() {
        SessionContext publisher = context(ClientType.MANAGEMENT_WEB, publishPermission());
        ModelCatalogRepository.VersionModelRow draft = model(
                UUID.randomUUID(), "Published model", Map.of("type", "object")
        );
        when(repository.findVersionByIdempotencyKey("publish-key-0001"))
                .thenReturn(Optional.empty());
        when(repository.findCurrentVersion()).thenReturn(Optional.empty());
        when(repository.findPublishableModels()).thenReturn(List.of(draft));
        when(repository.nextVersionNumber()).thenReturn(1L);
        var preview = service.preview(publisher);
        clearInvocations(repository);
        ModelCatalogRepository.VersionDetail published = versionDetail(
                1,
                preview.contentHash(),
                List.of(draft)
        );
        when(repository.findVersion(any())).thenReturn(Optional.of(published));

        var response = service.publish(
                publisher,
                "publish-key-0001",
                new PublishCatalogRequest(null, preview.contentHash())
        );

        assertThat(response.version()).isEqualTo(1);
        assertThat(response.modelCount()).isEqualTo(1);
        assertThat(response.idempotentReplay()).isFalse();
        InOrder order = inOrder(repository);
        order.verify(repository).acquirePublicationLock();
        order.verify(repository).findVersionByIdempotencyKey("publish-key-0001");
        order.verify(repository).findCurrentVersion();
        order.verify(repository).findPublishableModels();
        order.verify(repository).nextVersionNumber();
        order.verify(repository).createVersionHeader(any());
        order.verify(repository).insertVersionItems(any(), eq(List.of(draft)));
        order.verify(repository).sealVersion(any(), eq(NOW));
        order.verify(repository).replaceCurrentVersion(any());
        order.verify(repository).findVersion(any());
    }

    @Test
    void replaysTheSameIdempotencyKeyWithoutCreatingAnotherVersion() {
        SessionContext publisher = context(ClientType.MANAGEMENT_WEB, publishPermission());
        ModelCatalogRepository.VersionDetail existing = versionDetail(
                8,
                "a".repeat(64),
                List.of(model(UUID.randomUUID(), "Existing", Map.of()))
        );
        when(repository.findVersionByIdempotencyKey("publish-key-replay"))
                .thenReturn(Optional.of(existing));

        var response = service.publish(
                publisher,
                "publish-key-replay",
                new PublishCatalogRequest(7L, "a".repeat(64))
        );

        assertThat(response.version()).isEqualTo(8);
        assertThat(response.idempotentReplay()).isTrue();
        verify(repository, never()).createVersionHeader(any());
        verify(repository, never()).findPublishableModels();
    }

    @Test
    void rejectsReusedKeyStaleCurrentAndStalePreview() {
        SessionContext publisher = context(ClientType.MANAGEMENT_WEB, publishPermission());
        ModelCatalogRepository.VersionDetail current = versionDetail(
                3,
                "b".repeat(64),
                List.of(model(UUID.randomUUID(), "Current", Map.of()))
        );
        when(repository.findVersionByIdempotencyKey("publish-key-reused"))
                .thenReturn(Optional.of(current));
        assertApiError(() -> service.publish(
                        publisher,
                        "publish-key-reused",
                        new PublishCatalogRequest(2L, "c".repeat(64))
                ),
                409,
                "MODEL_CATALOG_IDEMPOTENCY_KEY_REUSED"
        );

        when(repository.findVersionByIdempotencyKey("publish-key-stale-current"))
                .thenReturn(Optional.empty());
        when(repository.findCurrentVersion()).thenReturn(Optional.of(current));
        assertApiError(() -> service.publish(
                        publisher,
                        "publish-key-stale-current",
                        new PublishCatalogRequest(2L, "d".repeat(64))
                ),
                409,
                "MODEL_CATALOG_CURRENT_VERSION_CONFLICT"
        );

        when(repository.findVersionByIdempotencyKey("publish-key-stale-preview"))
                .thenReturn(Optional.empty());
        when(repository.findPublishableModels()).thenReturn(List.of(
                model(UUID.randomUUID(), "Changed", Map.of())
        ));
        when(repository.nextVersionNumber()).thenReturn(4L);
        assertApiError(() -> service.publish(
                        publisher,
                        "publish-key-stale-preview",
                        new PublishCatalogRequest(3L, "d".repeat(64))
                ),
                409,
                "MODEL_CATALOG_PREVIEW_STALE"
        );
    }

    @Test
    void enforcesManagementPublishPermissionAndIdempotencyKeyFormat() {
        assertApiError(() -> service.preview(context(
                        ClientType.MANAGEMENT_WEB,
                        Set.of("model_catalog.manage")
                )),
                403,
                "MODEL_CATALOG_PUBLISH_FORBIDDEN"
        );
        assertApiError(() -> service.preview(context(
                        ClientType.DESKTOP,
                        publishPermission()
                )),
                403,
                "MODEL_CATALOG_PUBLISH_FORBIDDEN"
        );
        assertApiError(() -> service.publish(
                        context(ClientType.MANAGEMENT_WEB, publishPermission()),
                        "short",
                        new PublishCatalogRequest(null, "a".repeat(64))
                ),
                400,
                "INVALID_IDEMPOTENCY_KEY"
        );
    }

    private ModelCatalogRepository.VersionDetail versionDetail(
            long version,
            String hash,
            List<ModelCatalogRepository.VersionModelRow> models
    ) {
        return new ModelCatalogRepository.VersionDetail(
                new ModelCatalogRepository.VersionRow(
                        UUID.randomUUID(),
                        version,
                        true,
                        hash,
                        UUID.randomUUID(),
                        UUID.randomUUID(),
                        NOW,
                        NOW,
                        models.size()
                ),
                models
        );
    }

    private ModelCatalogRepository.VersionModelRow model(
            UUID modelId,
            String displayName,
            Map<String, Object> parameterSchema
    ) {
        return new ModelCatalogRepository.VersionModelRow(
                modelId,
                UUID.randomUUID(),
                "wave-provider",
                "Wave Provider",
                "openai_compatible",
                "wave-video-v1",
                displayName,
                "video",
                null,
                parameterSchema,
                Map.of("duration", 10),
                false,
                10
        );
    }

    private Set<String> publishPermission() {
        return Set.of("model_catalog.publish");
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "publisher",
                "publisher@example.com",
                UUID.randomUUID(),
                "tenant",
                "Tenant",
                UUID.randomUUID(),
                UUID.randomUUID(),
                clientType,
                "platform_admin",
                permissions,
                Map.of(),
                NOW.plusSeconds(600)
        );
    }

    private void assertApiError(Runnable action, int status, String code) {
        assertThatThrownBy(action::run)
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status().value()).isEqualTo(status);
                    assertThat(apiException.code()).isEqualTo(code);
                });
    }
}
