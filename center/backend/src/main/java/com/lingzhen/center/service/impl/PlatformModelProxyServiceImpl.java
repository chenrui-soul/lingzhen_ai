package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.PlatformProxyProperties;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskRequest;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.PlatformModelTaskRepository;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
import com.lingzhen.center.security.ProviderCredentialCipher;
import com.lingzhen.center.service.PlatformModelProxyService;
import com.lingzhen.center.service.PlatformProviderClient;
import com.lingzhen.center.service.PlatformTaskBillingService;
import com.lingzhen.center.service.PlatformTaskTransitionService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class PlatformModelProxyServiceImpl implements PlatformModelProxyService {
    private static final String PERMISSION = "model.use";
    private static final int MAX_ASSETS = 8;
    private final TenantModelRepository catalog;
    private final PlatformProxyProperties properties;
    private final PlatformProviderClient client;
    private final PlatformModelTaskRepository tasks;
    private final PlatformTaskBillingService billing;
    private final PlatformTaskTransitionService transitions;
    private final ModelRuntimeConfigRepository runtimeConfigs;
    private final ProviderCredentialCipher credentialCipher;

    public PlatformModelProxyServiceImpl(TenantModelRepository catalog,
                                         PlatformProxyProperties properties,
                                         PlatformProviderClient client,
                                         PlatformModelTaskRepository tasks,
                                         PlatformTaskBillingService billing,
                                         PlatformTaskTransitionService transitions,
                                         ModelRuntimeConfigRepository runtimeConfigs,
                                         ProviderCredentialCipher credentialCipher) {
        this.catalog = catalog;
        this.properties = properties;
        this.client = client;
        this.tasks = tasks;
        this.billing = billing;
        this.transitions = transitions;
        this.runtimeConfigs = runtimeConfigs;
        this.credentialCipher = credentialCipher;
    }

    @Override
    public PlatformModelTaskResponse submit(SessionContext context, PlatformModelTaskRequest request) {
        authorize(context);
        if (!properties.isEnabled()) throw unavailable("PLATFORM_PROXY_DISABLED", "平台模型代理暂未启用");
        if (request.assets().size() > MAX_ASSETS) throw bad("assets", "参考素材数量不能超过 8 个");
        TenantModelRepository.ModelRow model = findModel(context, request.modelId());
        if (!model.capabilityType().equals(request.creationType())) {
            throw bad("creationType", "任务类型与模型能力不匹配");
        }
        validateAssets(request.assets());
        ModelRuntimeEndpoint provider = provider(model.modelId());
        String clientRequestId = request.clientRequestId() == null || request.clientRequestId().isBlank()
                ? UUID.randomUUID().toString()
                : request.clientRequestId().trim();
        PlatformModelTaskRepository.TaskRow existing = tasks.findByClientRequestId(
                context.tenantId(), context.userId(), clientRequestId).orElse(null);
        if (existing != null) {
            if (!existing.modelId().equals(model.modelId()) || !existing.creationType().equals(request.creationType())) {
                throw bad("clientRequestId", "客户端请求标识已被其他模型任务使用");
            }
            return billedResponse(task(existing));
        }
        UUID taskId = UUID.randomUUID();
        Task task = tasks.create(new PlatformModelTaskRepository.CreateCommand(
                        taskId, context.tenantId(), context.userId(), model.modelId(), model.providerCode(),
                        request.creationType(), clientRequestId, "submitting"))
                .map(this::task)
                .orElseGet(() -> task(tasks.findByClientRequestId(context.tenantId(), context.userId(), clientRequestId)
                        .orElseThrow(() -> new IllegalStateException("Platform task idempotency conflict could not be resolved"))));
        if (!task.id().equals(taskId)) return billedResponse(task);
        try {
            billing.reserve(new PlatformTaskBillingService.ReservationRequest(
                    task.id(), task.tenantId(), task.userId(), task.modelId(), task.clientRequestId()));
        } catch (ApiException exception) {
            return save(task.with("failed", "", List.of(), "", exception.code(), exception.getMessage(), Map.of()));
        }
        PlatformProviderClient.ProviderResponse response = client.submit(new PlatformProviderClient.ProviderRequest(
                provider.baseUrl(), provider.apiKey(), submitPath(provider, request.creationType()), "",
                requestBody(model.code(), request), timeout(provider)));
        if (!response.transportOk()) {
            return save(task.with("submission_unknown", "", List.of(), "", "PLATFORM_SUBMISSION_UNKNOWN",
                    response.errorMessage(), response.body()));
        }
        if (!response.httpOk()) {
            String state = uncertainSubmitStatus(response.httpStatus()) ? "submission_unknown" : "failed";
            String code = "submission_unknown".equals(state)
                    ? "PLATFORM_SUBMISSION_UNKNOWN" : "PLATFORM_PROVIDER_REJECTED";
            return save(task.with(state, "", List.of(), "", code, response.errorMessage(), response.body()));
        }
        String providerJobId = providerJobId(response.body());
        List<String> urls = resultUrls(response.body());
        String text = resultText(response.body());
        String providerState = normalizedStatus(response.body());
        boolean hasResult = !urls.isEmpty() || !text.isBlank();
        String state = hasResult ? "completed"
                : List.of("failed", "error", "cancelled", "canceled").contains(providerState) ? "failed"
                : providerJobId != null && !providerJobId.isBlank() ? "pending" : "failed";
        String errorCode = "failed".equals(state) ? "PLATFORM_RESPONSE_INVALID" : "";
        String errorMessage = "failed".equals(state) ? "平台模型服务返回成功，但未提供任务标识或可用结果" : "";
        return save(task.with(state, providerJobId, urls, text, errorCode, errorMessage, response.body()));
    }

    @Override
    public PlatformModelTaskResponse status(SessionContext context, UUID taskId) {
        authorize(context);
        Task task = ownedTask(context, taskId);
        if (List.of("completed", "failed", "cancelled").contains(task.state())) return billedResponse(task);
        ModelRuntimeEndpoint provider = provider(task.modelId());
        if (task.providerJobId().isBlank()) return save(task.with("submission_unknown", "", task.resultUrls(), task.resultText(),
                "PLATFORM_IDENTIFIER_MISSING", "平台任务缺少可查询标识", task.raw()));
        PlatformProviderClient.ProviderResponse result = client.status(new PlatformProviderClient.ProviderRequest(
                provider.baseUrl(), provider.apiKey(), statusPath(provider, task.creationType(), task.providerJobId()),
                task.providerJobId(), Map.of(), timeout(provider)));
        if (!result.transportOk()) return save(task.with(task.state(), task.providerJobId(), task.resultUrls(), task.resultText(),
                "PLATFORM_STATUS_UNKNOWN", result.errorMessage(), task.raw()));
        if (!result.httpOk()) {
            return save(task.with(task.state(), task.providerJobId(), task.resultUrls(), task.resultText(),
                    "PLATFORM_STATUS_REJECTED", result.errorMessage(), result.body()));
        }
        List<String> urls = resultUrls(result.body());
        String text = resultText(result.body());
        String status = normalizedStatus(result.body());
        boolean hasResult = !urls.isEmpty() || !text.isBlank();
        boolean completedWithoutResult = !hasResult && List.of("completed", "succeeded", "success").contains(status);
        String next = hasResult ? "completed"
                : List.of("cancelled", "canceled").contains(status) ? "cancelled"
                : List.of("failed", "error").contains(status) ? "failed" : "pending";
        if (completedWithoutResult) next = "failed";
        String errorCode = "failed".equals(next)
                ? completedWithoutResult ? "PLATFORM_RESULT_MISSING" : "PLATFORM_PROVIDER_FAILED"
                : "";
        String errorMessage = "failed".equals(next)
                ? completedWithoutResult ? "平台模型任务已结束，但没有返回可用结果" : safeMessage(result)
                : "";
        return save(task.with(next, providerJobId(result.body(), task.providerJobId()), urls,
                text, errorCode, errorMessage, result.body()));
    }

    @Override
    public PlatformModelTaskResponse cancel(SessionContext context, UUID taskId) {
        authorize(context);
        Task task = ownedTask(context, taskId);
        if (List.of("completed", "failed", "cancelled").contains(task.state())) return billedResponse(task);
        ModelRuntimeEndpoint provider = provider(task.modelId());
        if (task.providerJobId().isBlank()) {
            if ("submitting".equals(task.state())) {
                return save(task.with("cancelled", "", task.resultUrls(), task.resultText(),
                        "", "用户已取消平台模型任务", task.raw()));
            }
            return save(task.with(task.state(), "", task.resultUrls(), task.resultText(),
                    "PLATFORM_CANCEL_UNKNOWN", "平台任务缺少上游标识，无法确认远程任务已停止", task.raw()));
        } else {
            PlatformProviderClient.ProviderResponse cancel = client.cancel(new PlatformProviderClient.ProviderRequest(provider.baseUrl(), provider.apiKey(),
                    cancelPath(provider, task.creationType(), task.providerJobId()), task.providerJobId(),
                    Map.of("id", task.providerJobId()), timeout(provider)));
            if (!cancel.transportOk()) {
                return save(task.with(task.state(), task.providerJobId(), task.resultUrls(), task.resultText(),
                        "PLATFORM_CANCEL_UNKNOWN", cancel.errorMessage(), cancel.body()));
            }
            if (!cancel.httpOk()) {
                return save(task.with(task.state(), task.providerJobId(), task.resultUrls(), task.resultText(),
                        "PLATFORM_CANCEL_REJECTED", cancel.errorMessage(), cancel.body()));
            }
        }
        return save(task.with("cancelled", task.providerJobId(), task.resultUrls(), task.resultText(), "", "用户已取消平台模型任务", task.raw()));
    }

    @Override
    public List<PlatformModelTaskResponse> recoverable(SessionContext context, int limit) {
        authorize(context);
        return tasks.findOwnedRecoverable(context.tenantId(), context.userId(), limit).stream()
                .map(this::task)
                .map(this::response)
                .toList();
    }

    private TenantModelRepository.ModelRow findModel(SessionContext context, UUID modelId) {
        if (modelId == null) throw bad("modelId", "模型不能为空");
        return catalog.findCurrentCatalog(context.tenantId(), true)
                .flatMap(value -> value.models().stream().filter(item -> item.modelId().equals(modelId)).findFirst())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "MODEL_NOT_AVAILABLE", "当前租户没有启用该平台模型"));
    }

    private ModelRuntimeEndpoint provider(UUID modelId) {
        var runtime = runtimeConfigs.findByModelId(modelId)
                .filter(ModelRuntimeConfigRepository.RuntimeConfigRow::enabled)
                .orElseThrow(() -> unavailable("PLATFORM_PROVIDER_NOT_CONFIGURED", "平台模型服务暂未配置，请联系管理员"));
        try {
            return new ModelRuntimeEndpoint(runtime.baseUrl(), credentialCipher.decrypt(runtime.apiKeyCiphertext()),
                    runtime.submitPath(), runtime.statusPath(), runtime.cancelPath(), runtime.timeoutSeconds());
        } catch (RuntimeException exception) {
            throw unavailable("PLATFORM_PROVIDER_NOT_CONFIGURED", "平台模型服务凭据无法读取，请联系管理员");
        }
    }


    private Map<String, Object> requestBody(String modelCode, PlatformModelTaskRequest request) {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("model", modelCode);
        body.put("prompt", request.prompt());
        if ("text".equals(request.creationType())) {
            body.put("messages", List.of(Map.of("role", "user", "content", request.prompt())));
        }
        request.parameters().forEach((key, value) -> {
            if (!List.of("model", "prompt", "messages").contains(String.valueOf(key).toLowerCase())) {
                body.put(key, value);
            }
        });
        if (!request.assets().isEmpty()) body.put("reference_images", request.assets().stream().map(PlatformModelTaskRequest.AssetReference::url).toList());
        return body;
    }

    private String submitPath(ModelRuntimeEndpoint provider, String type) {
        if (provider.submitPath() != null && !provider.submitPath().isBlank()) return provider.submitPath();
        return switch (type) { case "video" -> "/v1/videos"; case "image" -> "/v1/images/generations"; case "audio" -> "/v1/audio/speech"; default -> "/v1/chat/completions"; };
    }

    private String statusPath(ModelRuntimeEndpoint provider, String type, String id) {
        String path = provider.statusPath();
        if (path == null || path.isBlank()) path = switch (type) { case "video" -> "/v1/videos/{id}"; case "image" -> "/v1/images/generations/{id}"; default -> ""; };
        if (path.isBlank()) return path;
        return path.replace("{id}", java.net.URLEncoder.encode(id, java.nio.charset.StandardCharsets.UTF_8));
    }

    private String cancelPath(ModelRuntimeEndpoint provider, String type, String id) {
        String path = provider.cancelPath();
        if (path == null || path.isBlank()) path = statusPath(provider, type, id);
        return path == null ? "" : path.replace("{id}", java.net.URLEncoder.encode(id, java.nio.charset.StandardCharsets.UTF_8));
    }

    private int timeout(ModelRuntimeEndpoint provider) { return provider.timeoutSeconds() > 0 ? provider.timeoutSeconds() : properties.getDefaultTimeoutSeconds(); }
    private boolean uncertainSubmitStatus(int status) { return status == 408 || status == 425 || status == 429 || status >= 500; }
    private String providerJobId(Map<String, Object> body) { return providerJobId(body, ""); }
    private String providerJobId(Map<String, Object> body, String fallback) { for (String key : List.of("id", "task_id", "job_id", "request_id")) if (body.get(key) != null && !String.valueOf(body.get(key)).isBlank()) return String.valueOf(body.get(key)); return fallback; }
    private String normalizedStatus(Map<String, Object> body) { return String.valueOf(body.getOrDefault("status", body.getOrDefault("state", ""))).toLowerCase(); }
    private String resultText(Map<String, Object> body) {
        Object value = body.get("output_text");
        if (value == null && body.get("choices") instanceof List<?> choices && !choices.isEmpty()
                && choices.getFirst() instanceof Map<?, ?> choice) {
            Object message = choice.get("message");
            value = message instanceof Map<?, ?> map ? map.get("content") : choice.get("text");
        }
        if (value == null) return "";
        String text = String.valueOf(value);
        return text.substring(0, Math.min(200000, text.length()));
    }
    private String safeMessage(PlatformProviderClient.ProviderResponse response) { return response.errorMessage() == null ? "平台模型服务报告执行失败" : response.errorMessage(); }
    private List<String> resultUrls(Object value) { List<String> found = new ArrayList<>(); collectUrls(value, found, 0); return found.stream().distinct().limit(20).toList(); }
    private void collectUrls(Object value, List<String> found, int depth) { if (value == null || depth > 5) return; if (value instanceof String text && text.matches("(?i)https?://\\S+")) { found.add(text); return; } if (value instanceof Map<?, ?> map) map.values().forEach(item -> collectUrls(item, found, depth + 1)); else if (value instanceof Iterable<?> iterable) iterable.forEach(item -> collectUrls(item, found, depth + 1)); }
    private void authorize(SessionContext context) { if (context == null || context.clientType() != ClientType.DESKTOP || !context.permissions().contains(PERMISSION)) throw new ApiException(HttpStatus.FORBIDDEN, "DESKTOP_MODEL_EXECUTION_FORBIDDEN", "当前账号没有执行平台模型的权限"); }
    private void validateAssets(List<PlatformModelTaskRequest.AssetReference> assets) {
        for (PlatformModelTaskRequest.AssetReference asset : assets) {
            try {
                java.net.URI uri = java.net.URI.create(asset.url());
                if (!List.of("http", "https").contains(String.valueOf(uri.getScheme()).toLowerCase())) throw new IllegalArgumentException();
            } catch (RuntimeException exception) {
                throw bad("assets", "平台模型参考素材目前只支持 HTTP/HTTPS 地址");
            }
        }
    }
    private Task ownedTask(SessionContext context, UUID id) {
        return tasks.findOwned(context.tenantId(), context.userId(), id)
                .map(this::task)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "PLATFORM_TASK_NOT_FOUND", "平台模型任务不存在"));
    }
    private PlatformModelTaskResponse save(Task task) {
        PlatformTaskTransitionService.TransitionCommand command = new PlatformTaskTransitionService.TransitionCommand(
                task.id(), task.tenantId(), task.userId(), task.state(), task.providerJobId(), task.resultUrls(),
                task.resultText(), task.errorCode(), task.errorMessage(), task.rowVersion());
        PlatformTaskTransitionService.BillingAction action = billingAction(task.state());
        String resultReference = resultReference(task);
        boolean updated = transitions.transition(command, action, resultReference);
        Task stored = tasks.findOwned(task.tenantId(), task.userId(), task.id())
                .map(this::task)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "PLATFORM_TASK_NOT_FOUND", "平台模型任务不存在"));
        if (!updated) {
            transitions.reconcile(stored.id(), billingAction(stored.state()), resultReference(stored));
        }
        return response(stored);
    }
    private PlatformModelTaskResponse billedResponse(Task task) {
        transitions.reconcile(task.id(), billingAction(task.state()), resultReference(task));
        return response(task);
    }
    private PlatformTaskTransitionService.BillingAction billingAction(String state) {
        if ("completed".equals(state)) return PlatformTaskTransitionService.BillingAction.SETTLE;
        if (List.of("failed", "cancelled").contains(state)) return PlatformTaskTransitionService.BillingAction.RELEASE;
        return PlatformTaskTransitionService.BillingAction.NONE;
    }
    private String resultReference(Task task) {
        return task.resultUrls().isEmpty() ? "platform-task:" + task.id() : task.resultUrls().getFirst();
    }
    private PlatformModelTaskResponse response(Task task) { return new PlatformModelTaskResponse(task.id(), task.modelId(), task.providerCode(), task.state(), task.providerJobId(), task.resultUrls(), task.resultText(), task.errorCode(), task.errorMessage(), task.createdAt(), task.updatedAt()); }
    private ApiException unavailable(String code, String message) { return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, code, message); }
    private ApiException bad(String field, String message) { return new ApiException(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", field + "：" + message); }

    private Task task(PlatformModelTaskRepository.TaskRow row) {
        return new Task(row.id(), row.userId(), row.tenantId(), row.modelId(), row.providerCode(), row.creationType(),
                row.clientRequestId(), row.createdAt(), row.updatedAt(), row.state(), row.providerJobId() == null ? "" : row.providerJobId(), row.resultUrls(),
                row.resultText(), row.errorCode(), row.errorMessage(), row.rowVersion(), Map.of());
    }

    private record Task(UUID id, UUID userId, UUID tenantId, UUID modelId, String providerCode, String creationType,
                        String clientRequestId,
                        Instant createdAt, Instant updatedAt, String state, String providerJobId, List<String> resultUrls,
                        String resultText, String errorCode, String errorMessage, long rowVersion, Map<String, Object> raw) {
        Task with(String nextState, String nextJobId, List<String> urls, String text, String code, String message, Map<String, Object> body) {
            return new Task(id, userId, tenantId, modelId, providerCode, creationType, clientRequestId, createdAt, Instant.now(), nextState,
                    nextJobId == null ? providerJobId : nextJobId, urls == null ? resultUrls : List.copyOf(urls),
                    text == null ? resultText : text, code == null ? errorCode : code, message == null ? errorMessage : message,
                    rowVersion, body == null ? raw : Map.copyOf(body));
        }
    }

    private record ModelRuntimeEndpoint(String baseUrl, String apiKey, String submitPath, String statusPath,
                                        String cancelPath, int timeoutSeconds) {
    }
}
