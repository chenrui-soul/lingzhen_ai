package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.PlatformProxyProperties;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.PlatformModelTaskRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.security.ProviderCredentialCipher;
import com.lingzhen.center.service.PlatformProviderClient;
import com.lingzhen.center.service.PlatformTaskBillingService;
import com.lingzhen.center.service.PlatformTaskTransitionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentCaptor.forClass;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PlatformModelProxyServiceImplTest {
    private final TenantModelRepository catalog = mock(TenantModelRepository.class);
    private final PlatformProviderClient client = mock(PlatformProviderClient.class);
    private final PlatformTaskBillingService billing = mock(PlatformTaskBillingService.class);
    private final PlatformProxyProperties properties = new PlatformProxyProperties();
    private final ModelRuntimeConfigRepository runtimeConfigs = mock(ModelRuntimeConfigRepository.class);
    private final ProviderCredentialCipher credentialCipher = mock(ProviderCredentialCipher.class);
    private final MemoryPlatformModelTaskRepository tasks = new MemoryPlatformModelTaskRepository();
    private final UUID tenantId = UUID.randomUUID();
    private final UUID userId = UUID.randomUUID();
    private final UUID modelId = UUID.randomUUID();
    private PlatformModelProxyServiceImpl service;
    private PlatformTaskTransitionService transitions;

    @BeforeEach
    void setUp() {
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(runtime(modelId)));
        when(credentialCipher.decrypt("ciphertext")).thenReturn("server-only-secret");
        transitions = new PlatformTaskTransitionServiceImpl(tasks, billing);
        service = new PlatformModelProxyServiceImpl(catalog, properties, client, tasks, billing, transitions,
                runtimeConfigs, credentialCipher);
        when(catalog.findCurrentCatalog(tenantId, true)).thenReturn(Optional.of(new TenantModelRepository.TenantCatalog(
                1, Instant.now(), List.of(new TenantModelRepository.ModelRow(null, modelId, UUID.randomUUID(),
                "lingzhen", "灵帧平台", "video-v1", "视频模型", "video", Map.of(), Map.of(), true,
                "inherit", true, null)))));
    }

    @Test
    void submitValidatesTenantModelAndReturnsPendingTaskWithoutSecrets() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-1", "status", "queued"), ""));

        var response = service.submit(context(Set.of("model.use")), request());

        assertThat(response.state()).isEqualTo("pending");
        assertThat(response.providerJobId()).isEqualTo("upstream-1");
        assertThat(response.toString()).doesNotContain("secret-never-returned");
        verify(billing).reserve(any());
        verify(billing, never()).settle(any(), any());
        verify(billing, never()).release(any());
        verify(client).submit(any());
    }

    @Test
    void submitUsesConfiguredBaseUrlWhenSubmitPathIsBlankInsteadOfInferringAPath() {
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(new ModelRuntimeConfigRepository.RuntimeConfigRow(
                modelId, "https://gateway.example.com/v1/videos", "ciphertext", "", "/status/{id}", "/cancel/{id}",
                120, true, Instant.now(), Instant.now(), 0)));
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "configured-url-task", "status", "queued"), ""));

        service.submit(context(Set.of("model.use")), request());

        var captor = forClass(PlatformProviderClient.ProviderRequest.class);
        verify(client).submit(captor.capture());
        assertThat(captor.getValue().baseUrl()).isEqualTo("https://gateway.example.com/v1/videos");
        assertThat(captor.getValue().path()).isEmpty();
    }

    @Test
    void queryCompletesTheExistingTaskAndCollectsResultUrls() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-2", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        when(client.status(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-2", "status", "completed", "video_url", "https://cdn.example.com/result.mp4"), ""));

        var completed = service.status(context(Set.of("model.use")), submitted.taskId());

        assertThat(completed.state()).isEqualTo("completed");
        assertThat(completed.resultUrls()).containsExactly("https://cdn.example.com/result.mp4");
        verify(billing).settle(submitted.taskId(), "https://cdn.example.com/result.mp4");
    }

    @Test
    void missingModelQueryAddressMovesTaskToManualReviewWithoutCallingProvider() {
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(new ModelRuntimeConfigRepository.RuntimeConfigRow(
                modelId, "https://models.example.com", "ciphertext", "/v1/videos", "", "/v1/videos/{id}/cancel",
                120, true, Instant.now(), Instant.now(), 0)));
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-no-query", "status", "queued"), ""));

        var submitted = service.submit(context(Set.of("model.use")), request());
        var waiting = service.status(context(Set.of("model.use")), submitted.taskId());

        assertThat(waiting.state()).isEqualTo("submission_unknown");
        assertThat(waiting.errorCode()).isEqualTo("PLATFORM_STATUS_PATH_NOT_CONFIGURED");
        assertThat(waiting.errorMessage()).contains("查询地址");
        verify(client, never()).status(any());
        verify(billing, never()).release(any());
    }

    @Test
    void modelQueryAddressIsPassedThroughAsConfigured() {
        String queryUrl = "https://gateway.example.com/tasks/{id}";
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.of(new ModelRuntimeConfigRepository.RuntimeConfigRow(
                modelId, "https://gateway.example.com/submit", "ciphertext", "", queryUrl, "",
                120, true, Instant.now(), Instant.now(), 0)));
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "job-direct-url", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        when(client.status(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "job-direct-url", "status", "pending"), ""));

        service.status(context(Set.of("model.use")), submitted.taskId());

        var captor = forClass(PlatformProviderClient.ProviderRequest.class);
        verify(client).status(captor.capture());
        assertThat(captor.getValue().baseUrl()).isEqualTo("https://gateway.example.com/submit");
        assertThat(captor.getValue().path()).isEqualTo("https://gateway.example.com/tasks/job-direct-url");
    }

    @Test
    void transportFailureUsesSubmissionUnknownInsteadOfAutomaticFailure() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(false, false, 0,
                Map.of(), "平台模型服务暂时不可用"));

        var response = service.submit(context(Set.of("model.use")), request());

        assertThat(response.state()).isEqualTo("submission_unknown");
        assertThat(response.errorCode()).isEqualTo("PLATFORM_SUBMISSION_UNKNOWN");
        verify(billing, never()).release(any());
    }

    @Test
    void synchronousTextResponseCompletesEvenWhenProviderReturnsAnId() {
        when(catalog.findCurrentCatalog(tenantId, true)).thenReturn(Optional.of(new TenantModelRepository.TenantCatalog(
                1, Instant.now(), List.of(new TenantModelRepository.ModelRow(null, modelId, UUID.randomUUID(),
                "lingzhen", "灵帧平台", "text-v1", "文本模型", "text", Map.of(), Map.of(), true,
                "inherit", true, null)))));
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "chat-response-1", "choices", List.of(Map.of("message", Map.of("content", "生成完成")))), ""));

        var response = service.submit(context(Set.of("model.use")),
                new PlatformModelTaskRequest(modelId, "text", "写一句话", Map.of(), List.of(), "request-text-1"));

        assertThat(response.state()).isEqualTo("completed");
        assertThat(response.resultText()).isEqualTo("生成完成");
        verify(billing).settle(response.taskId(), "platform-task:" + response.taskId());
    }

    @Test
    void successfulResponseWithoutJobOrResultFailsExplicitly() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("status", "ok"), ""));

        var response = service.submit(context(Set.of("model.use")), request());

        assertThat(response.state()).isEqualTo("failed");
        assertThat(response.errorCode()).isEqualTo("PLATFORM_RESPONSE_INVALID");
        verify(billing).release(response.taskId());
    }

    @Test
    void repeatedClientRequestReturnsStoredTaskWithoutSubmittingAgain() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-idempotent", "status", "queued"), ""));

        var first = service.submit(context(Set.of("model.use")), request());
        var second = service.submit(context(Set.of("model.use")), request());

        assertThat(second.taskId()).isEqualTo(first.taskId());
        verify(billing, times(1)).reserve(any());
        verify(client).submit(any());
    }

    @Test
    void newServiceInstanceCanQueryPreviouslyPersistedTask() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-restart", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        PlatformModelProxyServiceImpl restarted = new PlatformModelProxyServiceImpl(
                catalog, properties, client, tasks, billing, transitions, runtimeConfigs, credentialCipher);
        when(client.status(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-restart", "status", "completed", "video_url", "https://cdn.example.com/restarted.mp4"), ""));

        var completed = restarted.status(context(Set.of("model.use")), submitted.taskId());

        assertThat(completed.state()).isEqualTo("completed");
        assertThat(completed.resultUrls()).containsExactly("https://cdn.example.com/restarted.mp4");
    }

    @Test
    void recoverableScanReturnsOnlyOpenTasksForTheAuthenticatedOwner() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-recovery", "status", "queued"), ""));

        var submitted = service.submit(context(Set.of("model.use")), request());

        assertThat(service.recoverable(context(Set.of("model.use")), 10))
                .extracting(response -> response.taskId())
                .containsExactly(submitted.taskId());
    }

    @Test
    void rejectsModelsOutsideTheCurrentTenantCatalog() {
        when(catalog.findCurrentCatalog(tenantId, true)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.submit(context(Set.of("model.use")), request()))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.code()).isEqualTo("MODEL_NOT_AVAILABLE"));
    }

    @Test
    void rejectsSessionsWithoutModelPermission() {
        assertThatThrownBy(() -> service.submit(context(Set.of()), request()))
                .isInstanceOfSatisfying(ApiException.class, error -> assertThat(error.status().value()).isEqualTo(403));
    }

    @Test
    void rejectsModelWithoutItsOwnRuntimeConfigurationInsteadOfUsingProviderFallback() {
        when(runtimeConfigs.findByModelId(modelId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.submit(context(Set.of("model.use")), request()))
                .isInstanceOfSatisfying(ApiException.class, error -> {
                    assertThat(error.status().value()).isEqualTo(503);
                    assertThat(error.code()).isEqualTo("PLATFORM_PROVIDER_NOT_CONFIGURED");
                });

        verify(client, never()).submit(any());
        verify(billing, never()).reserve(any());
    }

    @Test
    void insufficientCreditsFailTheTaskBeforeCallingTheProvider() {
        doThrow(new ApiException(org.springframework.http.HttpStatus.PAYMENT_REQUIRED,
                "CREDIT_INSUFFICIENT", "积分余额不足，请先充值"))
                .when(billing).reserve(any());

        var response = service.submit(context(Set.of("model.use")), request());

        assertThat(response.state()).isEqualTo("failed");
        assertThat(response.errorCode()).isEqualTo("CREDIT_INSUFFICIENT");
        verify(client, never()).submit(any());
    }

    @Test
    void providerServerErrorKeepsReservationBecauseSubmissionIsUnknown() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, false, 503,
                Map.of("message", "temporarily unavailable"), "temporarily unavailable"));

        var response = service.submit(context(Set.of("model.use")), request());

        assertThat(response.state()).isEqualTo("submission_unknown");
        verify(billing, never()).release(any());
    }

    @Test
    void explicitProviderRejectionReleasesReservation() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, false, 400,
                Map.of("message", "invalid request"), "invalid request"));

        var response = service.submit(context(Set.of("model.use")), request());

        assertThat(response.state()).isEqualTo("failed");
        verify(billing).release(response.taskId());
    }

    @Test
    void statusHttpFailureKeepsReservationAndOriginalState() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-status-unknown", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        when(client.status(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, false, 503,
                Map.of(), "temporarily unavailable"));

        var response = service.status(context(Set.of("model.use")), submitted.taskId());

        assertThat(response.state()).isEqualTo("pending");
        assertThat(response.errorCode()).isEqualTo("PLATFORM_STATUS_REJECTED");
        verify(billing, never()).release(any());
    }

    @Test
    void explicitProviderFailureFromStatusReleasesReservation() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-failed", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        when(client.status(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-failed", "status", "failed"), "generation failed"));

        var response = service.status(context(Set.of("model.use")), submitted.taskId());

        assertThat(response.state()).isEqualTo("failed");
        verify(billing).release(submitted.taskId());
    }

    @Test
    void confirmedRemoteCancellationReleasesReservation() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-cancel", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        when(client.cancel(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("status", "cancelled"), ""));

        var response = service.cancel(context(Set.of("model.use")), submitted.taskId());

        assertThat(response.state()).isEqualTo("cancelled");
        verify(billing).release(submitted.taskId());
    }

    @Test
    void unknownRemoteCancellationKeepsTaskAndReservationOpen() {
        when(client.submit(any())).thenReturn(new PlatformProviderClient.ProviderResponse(true, true, 200,
                Map.of("id", "upstream-cancel-unknown", "status", "queued"), ""));
        var submitted = service.submit(context(Set.of("model.use")), request());
        when(client.cancel(any())).thenReturn(new PlatformProviderClient.ProviderResponse(false, false, 0,
                Map.of(), "timeout"));

        var response = service.cancel(context(Set.of("model.use")), submitted.taskId());

        assertThat(response.state()).isEqualTo("pending");
        assertThat(response.errorCode()).isEqualTo("PLATFORM_CANCEL_UNKNOWN");
        verify(billing, never()).release(any());
    }

    private PlatformModelTaskRequest request() {
        return new PlatformModelTaskRequest(modelId, "video", "生成一段测试视频", Map.of("seconds", 10), List.of(), "request-1");
    }

    private ModelRuntimeConfigRepository.RuntimeConfigRow runtime(UUID id) {
        return new ModelRuntimeConfigRepository.RuntimeConfigRow(
                id, "https://models.example.com", "ciphertext", "/v1/videos", "/v1/videos/{id}",
                "/v1/videos/{id}/cancel", 120, true, Instant.now(), Instant.now(), 0);
    }

    private SessionContext context(Set<String> permissions) {
        return new SessionContext(UUID.randomUUID(), userId, "user", "user@example.com", tenantId, "tenant",
                "Tenant", UUID.randomUUID(), UUID.randomUUID(), ClientType.DESKTOP, "member", permissions,
                Map.of(), Instant.now().plusSeconds(600));
    }

    private static final class MemoryPlatformModelTaskRepository implements PlatformModelTaskRepository {
        private final Map<UUID, TaskRow> rows = new ConcurrentHashMap<>();

        @Override
        public Optional<TaskRow> findOwned(UUID tenantId, UUID userId, UUID taskId) {
            TaskRow row = rows.get(taskId);
            return row != null && row.tenantId().equals(tenantId) && row.userId().equals(userId)
                    ? Optional.of(row) : Optional.empty();
        }

        @Override
        public Optional<TaskRow> findByClientRequestId(UUID tenantId, UUID userId, String clientRequestId) {
            return rows.values().stream().filter(row -> row.tenantId().equals(tenantId)
                    && row.userId().equals(userId) && row.clientRequestId().equals(clientRequestId)).findFirst();
        }

        @Override
        public List<TaskRow> findOwnedRecoverable(UUID tenantId, UUID userId, int limit) {
            return rows.values().stream()
                    .filter(row -> row.tenantId().equals(tenantId) && row.userId().equals(userId))
                    .filter(row -> Set.of("submitting", "pending", "submission_unknown").contains(row.state()))
                    .limit(Math.max(1, Math.min(limit, 100)))
                    .toList();
        }

        @Override
        public synchronized Optional<TaskRow> create(CreateCommand command) {
            if (findByClientRequestId(command.tenantId(), command.userId(), command.clientRequestId()).isPresent()) {
                return Optional.empty();
            }
            Instant now = Instant.now();
            TaskRow row = new TaskRow(command.id(), command.tenantId(), command.userId(), command.modelId(),
                    command.providerCode(), command.creationType(), command.clientRequestId(), command.state(), "",
                    List.of(), "", "", "", now, now, 0);
            rows.put(row.id(), row);
            return Optional.of(row);
        }

        @Override
        public synchronized Optional<TaskRow> update(UpdateCommand command) {
            TaskRow current = rows.get(command.id());
            if (current == null || current.rowVersion() != command.rowVersion()
                    || !current.tenantId().equals(command.tenantId()) || !current.userId().equals(command.userId())) {
                return Optional.empty();
            }
            TaskRow row = new TaskRow(current.id(), current.tenantId(), current.userId(), current.modelId(),
                    current.providerCode(), current.creationType(), current.clientRequestId(), command.state(),
                    command.providerJobId(), List.copyOf(command.resultUrls()), command.resultText(), command.errorCode(),
                    command.errorMessage(), current.createdAt(), Instant.now(), current.rowVersion() + 1);
            rows.put(row.id(), row);
            return Optional.of(row);
        }
    }
}
