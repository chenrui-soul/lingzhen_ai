package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelRequest;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ModelCatalogRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
import com.lingzhen.center.security.ProviderCredentialCipher;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import tools.jackson.databind.ObjectMapper;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ModelCatalogCommandServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T06:00:00Z");

    private final ModelCatalogRepository repository = mock(ModelCatalogRepository.class);
    private final ModelCatalogCommandServiceImpl service = new ModelCatalogCommandServiceImpl(
            repository,
            new ModelCatalogContractValidator(new ObjectMapper())
    );

    @Test
    void createsProviderAsDraftWithNormalizedCode() {
        when(repository.createProvider(any())).thenAnswer(invocation -> {
            ModelCatalogRepository.ProviderCreateCommand command = invocation.getArgument(0);
            return Optional.of(provider(command.id(), "draft", 0));
        });

        var response = service.createProvider(
                context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                new CreateModelProviderRequest(
                        "wave34-provider",
                        "  Wave Provider  ",
                        "OPENAI_COMPATIBLE",
                        "  provider description  "
                )
        );

        ArgumentCaptor<ModelCatalogRepository.ProviderCreateCommand> captor =
                ArgumentCaptor.forClass(ModelCatalogRepository.ProviderCreateCommand.class);
        verify(repository).createProvider(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo("wave34-provider");
        assertThat(captor.getValue().displayName()).isEqualTo("Wave Provider");
        assertThat(captor.getValue().protocolFamily()).isEqualTo("openai_compatible");
        assertThat(response.status()).isEqualTo("draft");
        assertThat(response.rowVersion()).isZero();
    }

    @Test
    void rejectsProviderDeactivationWhileActiveModelsExist() {
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        when(repository.findProvider(providerId)).thenReturn(Optional.of(
                provider(providerId, "active", 2)
        ));
        when(repository.providerHasActiveModels(providerId)).thenReturn(true);

        assertApiError(() -> service.updateProvider(
                        context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                        providerId,
                        new UpdateModelProviderRequest(
                                "Provider", "custom_proxy", null, "inactive", 2L
                        )
                ),
                409,
                "MODEL_PROVIDER_HAS_ACTIVE_MODELS"
        );

        verify(repository, never()).updateProvider(any());
    }

    @Test
    void returnsOptimisticLockConflictWhenProviderVersionIsStale() {
        UUID providerId = UUID.randomUUID();
        when(repository.findProvider(providerId)).thenReturn(Optional.of(
                provider(providerId, "draft", 3)
        ));
        when(repository.providerHasActiveModels(providerId)).thenReturn(false);
        when(repository.updateProvider(any())).thenReturn(Optional.empty());

        assertApiError(() -> service.updateProvider(
                        context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                        providerId,
                        new UpdateModelProviderRequest(
                                "Provider", "custom_proxy", null, "active", 2L
                        )
                ),
                409,
                "MODEL_ROW_VERSION_CONFLICT"
        );
    }

    @Test
    void keepsExistingCredentialAndUsesCurrentRuntimeVersionWhenVersionIsOmitted() {
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        ModelRuntimeConfigRepository runtimeConfigs = mock(ModelRuntimeConfigRepository.class);
        ProviderCredentialCipher credentialCipher = mock(ProviderCredentialCipher.class);
        ModelCatalogCommandServiceImpl runtimeService = new ModelCatalogCommandServiceImpl(
                repository,
                new ModelCatalogContractValidator(new ObjectMapper()),
                credentialCipher,
                runtimeConfigs
        );
        var currentRuntime = runtime(modelId, "cipher-old", 4L);
        when(repository.findModel(modelId)).thenReturn(Optional.of(model(modelId, providerId, "active", 4)));
        when(repository.findProvider(providerId)).thenReturn(Optional.of(provider(providerId, "active", 2)));
        when(repository.updateModel(any())).thenReturn(Optional.of(model(modelId, providerId, "active", 5)));
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(currentRuntime));
        when(credentialCipher.decrypt("cipher-old")).thenReturn("secret-old");
        when(credentialCipher.encrypt("secret-old")).thenReturn("cipher-new");
        when(runtimeConfigs.upsert(any())).thenReturn(runtime(modelId, "cipher-new", 5L));

        runtimeService.updateModel(
                context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                modelId,
                new UpdateModelRequest(
                        providerId, "wave34-video-v1", "Wave Video", "video", null,
                        Map.of("type", "object"), Map.of(), false, 0, "active", 4L,
                        "https://api.example.com", null, "/submit", "/status/{id}", null,
                        180, true, null
                )
        );

        ArgumentCaptor<ModelRuntimeConfigRepository.UpsertCommand> captor =
                ArgumentCaptor.forClass(ModelRuntimeConfigRepository.UpsertCommand.class);
        verify(runtimeConfigs).upsert(captor.capture());
        assertThat(captor.getValue().apiKeyCiphertext()).isEqualTo("cipher-new");
        assertThat(captor.getValue().rowVersion()).isEqualTo(4L);
        assertThat(captor.getValue().timeoutSeconds()).isEqualTo(180);
    }

    @Test
    void mapsRuntimeOptimisticLockConflictToApiConflict() {
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        ModelRuntimeConfigRepository runtimeConfigs = mock(ModelRuntimeConfigRepository.class);
        ProviderCredentialCipher credentialCipher = mock(ProviderCredentialCipher.class);
        ModelCatalogCommandServiceImpl runtimeService = new ModelCatalogCommandServiceImpl(
                repository,
                new ModelCatalogContractValidator(new ObjectMapper()),
                credentialCipher,
                runtimeConfigs
        );
        when(repository.findModel(modelId)).thenReturn(Optional.of(model(modelId, providerId, "active", 4)));
        when(repository.findProvider(providerId)).thenReturn(Optional.of(provider(providerId, "active", 2)));
        when(repository.updateModel(any())).thenReturn(Optional.of(model(modelId, providerId, "active", 5)));
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(runtime(modelId, "cipher-old", 4L)));
        when(credentialCipher.decrypt("cipher-old")).thenReturn("secret-old");
        when(credentialCipher.encrypt("secret-old")).thenReturn("cipher-new");
        when(runtimeConfigs.upsert(any())).thenThrow(new IllegalStateException("MODEL_RUNTIME_CONFIG_CONFLICT"));

        assertApiError(() -> runtimeService.updateModel(
                        context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                        modelId,
                        new UpdateModelRequest(
                                providerId, "wave34-video-v1", "Wave Video", "video", null,
                                Map.of("type", "object"), Map.of(), false, 0, "active", 4L,
                                "https://api.example.com", null, null, null, null,
                                120, true, 4L
                        )
                ),
                409,
                "MODEL_RUNTIME_CONFIG_CONFLICT"
        );
    }

    @Test
    void createsModelWithSafeContractAndDefaultValues() {
        UUID providerId = UUID.randomUUID();
        when(repository.findProvider(providerId)).thenReturn(Optional.of(
                provider(providerId, "draft", 0)
        ));
        when(repository.createModel(any())).thenAnswer(invocation -> {
            ModelCatalogRepository.ModelCreateCommand command = invocation.getArgument(0);
            return Optional.of(model(command.id(), providerId, "draft", 0));
        });

        var response = service.createModel(
                context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                new CreateModelRequest(
                        providerId,
                        "wave34-video-v1",
                        "Wave Video",
                        "VIDEO",
                        null,
                        Map.of("type", "object", "properties", Map.of()),
                        Map.of(),
                        null,
                        null
                )
        );

        ArgumentCaptor<ModelCatalogRepository.ModelCreateCommand> captor =
                ArgumentCaptor.forClass(ModelCatalogRepository.ModelCreateCommand.class);
        verify(repository).createModel(captor.capture());
        assertThat(captor.getValue().capabilityType()).isEqualTo("video");
        assertThat(captor.getValue().defaultTenantEnabled()).isFalse();
        assertThat(captor.getValue().sortOrder()).isZero();
        assertThat(response.status()).isEqualTo("draft");
    }

    @Test
    void rejectsActivatingModelUnderInactiveProvider() {
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        when(repository.findModel(modelId)).thenReturn(Optional.of(
                model(modelId, providerId, "draft", 0)
        ));
        when(repository.findProvider(providerId)).thenReturn(Optional.of(
                provider(providerId, "inactive", 1)
        ));

        assertApiError(() -> service.updateModel(
                        context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage")),
                        modelId,
                        updateModel(providerId, "active", 0)
                ),
                409,
                "MODEL_PROVIDER_NOT_ACTIVE"
        );

        verify(repository, never()).updateModel(any());
    }

    @Test
    void rejectsSensitiveAndInvalidSchemaStructures() {
        UUID providerId = UUID.randomUUID();
        when(repository.findProvider(providerId)).thenReturn(Optional.of(
                provider(providerId, "active", 0)
        ));
        SessionContext context = context(ClientType.MANAGEMENT_WEB, Set.of("model_catalog.manage"));

        assertApiError(() -> service.createModel(
                        context,
                        createModel(providerId, Map.of("properties", Map.of("apiKey", Map.of())))
                ),
                400,
                "MODEL_SCHEMA_INVALID"
        );
        assertApiError(() -> service.createModel(
                        context,
                        createModel(providerId, Map.of("type", "array"))
                ),
                400,
                "MODEL_SCHEMA_INVALID"
        );
        assertApiError(() -> service.createModel(
                        context,
                        createModel(providerId, nestedMap(13))
                ),
                400,
                "MODEL_SCHEMA_INVALID"
        );

        verify(repository, never()).createModel(any());
    }

    @Test
    void serviceRechecksManagementTerminalAndPermission() {
        CreateModelProviderRequest request = new CreateModelProviderRequest(
                "wave34-provider", "Provider", "custom_proxy", null
        );

        assertApiError(() -> service.createProvider(
                        context(ClientType.DESKTOP, Set.of("model_catalog.manage")), request),
                403,
                "MODEL_CATALOG_MANAGE_FORBIDDEN"
        );
        assertApiError(() -> service.createProvider(
                        context(ClientType.MANAGEMENT_WEB, Set.of()), request),
                403,
                "MODEL_CATALOG_MANAGE_FORBIDDEN"
        );
    }

    private CreateModelRequest createModel(UUID providerId, Map<String, Object> schema) {
        return new CreateModelRequest(
                providerId,
                "wave34-video-v1",
                "Wave Video",
                "video",
                null,
                schema,
                Map.of(),
                false,
                0
        );
    }

    private UpdateModelRequest updateModel(UUID providerId, String status, long rowVersion) {
        return new UpdateModelRequest(
                providerId,
                "wave34-video-v1",
                "Wave Video",
                "video",
                null,
                Map.of("type", "object"),
                Map.of(),
                false,
                0,
                status,
                rowVersion
        );
    }

    private Map<String, Object> nestedMap(int depth) {
        Map<String, Object> value = Map.of("leaf", true);
        for (int index = 0; index < depth; index++) {
            value = Map.of("level" + index, value);
        }
        return value;
    }

    private ModelCatalogRepository.ProviderRow provider(UUID id, String status, long rowVersion) {
        return new ModelCatalogRepository.ProviderRow(
                id,
                "wave34-provider",
                "Wave Provider",
                "openai_compatible",
                null,
                status,
                NOW,
                NOW,
                rowVersion
        );
    }

    private ModelCatalogRepository.ModelRow model(
            UUID id,
            UUID modelId,
            String status,
            long rowVersion
    ) {
        return new ModelCatalogRepository.ModelRow(
                id,
                modelId,
                "wave34-provider",
                "Wave Provider",
                "wave34-video-v1",
                "Wave Video",
                "video",
                null,
                Map.of("type", "object"),
                Map.of(),
                false,
                0,
                status,
                NOW,
                NOW,
                rowVersion
        );
    }

    private ModelRuntimeConfigRepository.RuntimeConfigRow runtime(
            UUID providerId,
            String ciphertext,
            long rowVersion
    ) {
        return new ModelRuntimeConfigRepository.RuntimeConfigRow(
                providerId,
                "https://api.example.com",
                ciphertext,
                "/submit",
                "/status/{id}",
                null,
                120,
                true,
                NOW,
                NOW,
                rowVersion
        );
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "tester",
                "tester@example.com",
                UUID.randomUUID(),
                "tenant",
                "Tenant",
                UUID.randomUUID(),
                UUID.randomUUID(),
                clientType,
                "owner",
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
