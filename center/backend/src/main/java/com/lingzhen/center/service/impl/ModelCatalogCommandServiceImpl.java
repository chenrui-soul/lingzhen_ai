package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelRequest;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelResponse;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.model.enums.ModelCapabilityType;
import com.lingzhen.center.model.enums.ModelCatalogStatus;
import com.lingzhen.center.model.enums.ModelProviderProtocolFamily;
import com.lingzhen.center.repository.ModelCatalogRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
import com.lingzhen.center.repository.ModelPriceRepository;
import com.lingzhen.center.security.ProviderCredentialCipher;
import com.lingzhen.center.service.ModelCatalogCommandService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Locale;
import java.util.UUID;

@Service
public class ModelCatalogCommandServiceImpl implements ModelCatalogCommandService {

    private static final String MANAGE_PERMISSION = "model_catalog.manage";

    private final ModelCatalogRepository repository;
    private final ModelRuntimeConfigRepository modelRuntimeConfigs;
    private final ProviderCredentialCipher credentialCipher;
    private final ModelPriceRepository modelPrices;

    public ModelCatalogCommandServiceImpl(ModelCatalogRepository repository,
                                          ModelCatalogContractValidator contractValidator) {
        this(repository, contractValidator, null, null, null);
    }
    private final ModelCatalogContractValidator contractValidator;

    @org.springframework.beans.factory.annotation.Autowired
    public ModelCatalogCommandServiceImpl(
            ModelCatalogRepository repository,
            ModelCatalogContractValidator contractValidator,
            ProviderCredentialCipher credentialCipher,
            ModelRuntimeConfigRepository modelRuntimeConfigs,
            ModelPriceRepository modelPrices
    ) {
        this.repository = repository;
        this.contractValidator = contractValidator;
        this.credentialCipher = credentialCipher;
        this.modelRuntimeConfigs = modelRuntimeConfigs;
        this.modelPrices = modelPrices;
    }

    public ModelCatalogCommandServiceImpl(
            ModelCatalogRepository repository,
            ModelCatalogContractValidator contractValidator,
            ProviderCredentialCipher credentialCipher,
            ModelRuntimeConfigRepository modelRuntimeConfigs
    ) {
        this(repository, contractValidator, credentialCipher, modelRuntimeConfigs, null);
    }

    @Override
    @Transactional
    public ModelProviderResponse createProvider(
            SessionContext sessionContext,
            CreateModelProviderRequest request
    ) {
        requirePermission(sessionContext);
        String protocolFamily = protocolFamily(request.protocolFamily());
        ModelCatalogRepository.ProviderRow result = repository.createProvider(
                        new ModelCatalogRepository.ProviderCreateCommand(
                                UUID.randomUUID(),
                                request.code().trim().toLowerCase(Locale.ROOT),
                                request.displayName().trim(),
                                protocolFamily,
                                trimToNull(request.description())
                        ))
                .orElseThrow(() -> new ApiException(
                        HttpStatus.CONFLICT,
                        "MODEL_PROVIDER_CODE_CONFLICT",
                        "厂商代码已存在"
                ));
        return providerResponse(result);
    }

    @Override
    @Transactional
    public ModelProviderResponse updateProvider(
            SessionContext sessionContext,
            UUID providerId,
            UpdateModelProviderRequest request
    ) {
        requirePermission(sessionContext);
        ModelCatalogRepository.ProviderRow current = provider(providerId);
        if (current.rowVersion() != request.rowVersion()) {
            throw rowVersionConflict();
        }
        String status = status(request.status());
        if (!"active".equals(status) && repository.providerHasActiveModels(providerId)) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_PROVIDER_HAS_ACTIVE_MODELS",
                    "厂商仍有启用中的模型，请先停用相关模型"
            );
        }
        try {
            ModelCatalogRepository.ProviderRow result = repository.updateProvider(
                            new ModelCatalogRepository.ProviderUpdateCommand(
                                    current.id(),
                                    request.displayName().trim(),
                                    protocolFamily(request.protocolFamily()),
                                    trimToNull(request.description()),
                                    status,
                                    request.rowVersion()
                            ))
                    .orElseThrow(this::rowVersionConflict);
            return providerResponse(result);
        } catch (DataIntegrityViolationException exception) {
            throw mapDataConflict(exception);
        }
    }

    @Override
    @Transactional
    public ModelResponse createModel(SessionContext sessionContext, CreateModelRequest request) {
        requirePermission(sessionContext);
        provider(request.providerId());
        ModelCatalogContractValidator.ValidatedContract contract = contractValidator.validate(
                request.parameterSchema(),
                request.defaultParameters()
        );
        try {
            ModelCatalogRepository.ModelRow result = repository.createModel(
                            new ModelCatalogRepository.ModelCreateCommand(
                                    UUID.randomUUID(),
                                    request.providerId(),
                                    request.code().trim(),
                                    request.displayName().trim(),
                                    capability(request.capabilityType()),
                                    trimToNull(request.description()),
                                    contract.parameterSchema(),
                                    contract.defaultParameters(),
                                    Boolean.TRUE.equals(request.defaultTenantEnabled()),
                                    request.sortOrder() == null ? 0 : request.sortOrder()
                            ))
                    .orElseThrow(() -> new ApiException(
                            HttpStatus.CONFLICT,
                            "MODEL_CODE_CONFLICT",
                            "该厂商下的模型代码已存在"
                    ));
            saveModelRuntimeConfig(result.id(), request.baseUrl(), request.apiKey(), request.submitPath(),
                    request.statusPath(), request.cancelPath(), request.timeoutSeconds(), request.runtimeEnabled(), null);
            saveModelPrice(sessionContext, result.id(), request.baseCredits(), request.maxReserveCredits(), null);
            return modelResponse(result);
        } catch (DataIntegrityViolationException exception) {
            throw mapDataConflict(exception);
        }
    }

    @Override
    @Transactional
    public ModelResponse updateModel(
            SessionContext sessionContext,
            UUID modelId,
            UpdateModelRequest request
    ) {
        requirePermission(sessionContext);
        ModelCatalogRepository.ModelRow current = model(modelId);
        if (current.rowVersion() != request.rowVersion()) {
            throw rowVersionConflict();
        }
        ModelCatalogRepository.ProviderRow provider = provider(request.providerId());
        String status = status(request.status());
        if ("active".equals(status) && !"active".equals(provider.status())) {
            throw providerNotActive();
        }
        ModelCatalogContractValidator.ValidatedContract contract = contractValidator.validate(
                request.parameterSchema(),
                request.defaultParameters()
        );
        try {
            ModelCatalogRepository.ModelRow result = repository.updateModel(
                            new ModelCatalogRepository.ModelUpdateCommand(
                                    modelId,
                                    request.providerId(),
                                    request.code().trim(),
                                    request.displayName().trim(),
                                    capability(request.capabilityType()),
                                    trimToNull(request.description()),
                                    contract.parameterSchema(),
                                    contract.defaultParameters(),
                                    request.defaultTenantEnabled(),
                                    request.sortOrder(),
                                    status,
                                    request.rowVersion()
                            ))
                    .orElseThrow(this::rowVersionConflict);
            saveModelRuntimeConfig(result.id(), request.baseUrl(), request.apiKey(), request.submitPath(),
                    request.statusPath(), request.cancelPath(), request.timeoutSeconds(), request.runtimeEnabled(),
                    request.runtimeRowVersion());
            saveModelPrice(sessionContext, result.id(), request.baseCredits(), request.maxReserveCredits(),
                    request.priceRowVersion());
            return modelResponse(result);
        } catch (DataIntegrityViolationException exception) {
            throw mapDataConflict(exception);
        }
    }

    private void requirePermission(SessionContext context) {
        if (context == null
                || context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(MANAGE_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "MODEL_CATALOG_MANAGE_FORBIDDEN",
                    "当前账号没有维护平台模型目录的权限"
            );
        }
    }

    private ModelCatalogRepository.ProviderRow provider(UUID providerId) {
        if (providerId == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_MODEL_PROVIDER_ID",
                    "厂商标识不正确"
            );
        }
        return repository.findProvider(providerId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "MODEL_PROVIDER_NOT_FOUND",
                        "模型厂商不存在"
                ));
    }

    private ModelCatalogRepository.ModelRow model(UUID modelId) {
        if (modelId == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_MODEL_ID",
                    "模型标识不正确"
            );
        }
        return repository.findModel(modelId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "MODEL_NOT_FOUND",
                        "模型不存在"
                ));
    }

    private String protocolFamily(String value) {
        return ModelProviderProtocolFamily.find(value)
                .map(ModelProviderProtocolFamily::value)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_MODEL_PROVIDER_PROTOCOL",
                        "厂商协议类型不正确"
                ));
    }

    private String status(String value) {
        return ModelCatalogStatus.find(value)
                .map(ModelCatalogStatus::value)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_MODEL_STATUS",
                        "模型目录状态不正确"
                ));
    }

    private String capability(String value) {
        return ModelCapabilityType.find(value)
                .map(ModelCapabilityType::value)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_MODEL_CAPABILITY",
                        "模型能力类型不正确"
                ));
    }

    private String trimToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }

    private ApiException rowVersionConflict() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "MODEL_ROW_VERSION_CONFLICT",
                "数据已被其他操作更新，请刷新后重试"
        );
    }

    private ApiException providerNotActive() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "MODEL_PROVIDER_NOT_ACTIVE",
                "启用模型前必须先启用所属厂商"
        );
    }

    private ApiException mapDataConflict(DataIntegrityViolationException exception) {
        String message = rootMessage(exception).toLowerCase(Locale.ROOT);
        if (message.contains("models_provider_code_uk")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_CODE_CONFLICT",
                    "该厂商下的模型代码已存在"
            );
        }
        if (message.contains("active model requires an active provider")) {
            return providerNotActive();
        }
        if (message.contains("provider with active models cannot be deactivated")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_PROVIDER_HAS_ACTIVE_MODELS",
                    "厂商仍有启用中的模型，请先停用相关模型"
            );
        }
        throw exception;
    }

    private String rootMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? "" : current.getMessage();
    }

    private ModelProviderResponse providerResponse(ModelCatalogRepository.ProviderRow item) {
        return new ModelProviderResponse(
                item.id(),
                item.code(),
                item.displayName(),
                item.protocolFamily(),
                item.description(),
                item.status(),
                item.createdAt(),
                item.updatedAt(),
                item.rowVersion()
        );
    }

    private void saveModelRuntimeConfig(
            UUID modelId,
            String baseUrl,
            String apiKey,
            String submitPath,
            String statusPath,
            String cancelPath,
            Integer timeoutSeconds,
            Boolean runtimeEnabled,
            Long runtimeRowVersion
    ) {
        if (modelRuntimeConfigs == null || credentialCipher == null) return;
        String normalizedUrl = trimToNull(baseUrl);
        String normalizedKey = trimToNull(apiKey);
        var current = modelRuntimeConfigs.findByModelId(modelId);
        if (normalizedUrl == null && normalizedKey == null && current.isEmpty()) return;
        if (normalizedUrl == null && current.isPresent()) normalizedUrl = current.get().baseUrl();
        if (normalizedKey == null && current.isPresent()) normalizedKey = credentialCipher.decrypt(current.get().apiKeyCiphertext());
        if (normalizedUrl == null || normalizedKey == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MODEL_RUNTIME_CONFIG_INCOMPLETE", "模型调用地址和密钥必须同时填写");
        }
        if (!normalizedUrl.matches("https?://[^\\s]+")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MODEL_RUNTIME_URL_INVALID", "模型调用地址必须是 HTTP/HTTPS 地址");
        }
        int timeout = timeoutSeconds == null ? current.map(ModelRuntimeConfigRepository.RuntimeConfigRow::timeoutSeconds).orElse(120) : timeoutSeconds;
        if (timeout < 1 || timeout > 600) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MODEL_RUNTIME_TIMEOUT_INVALID", "超时时间必须在 1 到 600 秒之间");
        }
        Long expectedVersion = runtimeRowVersion == null
                ? current.map(ModelRuntimeConfigRepository.RuntimeConfigRow::rowVersion).orElse(null)
                : runtimeRowVersion;
        try {
            modelRuntimeConfigs.upsert(new ModelRuntimeConfigRepository.UpsertCommand(
                    modelId, normalizedUrl, credentialCipher.encrypt(normalizedKey), trimToNull(submitPath),
                    trimToNull(statusPath), trimToNull(cancelPath), timeout,
                    runtimeEnabled == null ? current.map(ModelRuntimeConfigRepository.RuntimeConfigRow::enabled).orElse(true) : runtimeEnabled,
                    expectedVersion));
        } catch (IllegalStateException exception) {
            if ("MODEL_RUNTIME_CONFIG_CONFLICT".equals(exception.getMessage())) {
                throw new ApiException(HttpStatus.CONFLICT, "MODEL_RUNTIME_CONFIG_CONFLICT", "模型调用配置已被其他操作更新，请刷新后重试");
            }
            throw exception;
        }
    }

    private void saveModelPrice(
            SessionContext sessionContext,
            UUID modelId,
            Long baseCredits,
            Long maxReserveCredits,
            Long expectedRowVersion
    ) {
        if (modelPrices == null || (baseCredits == null && maxReserveCredits == null)) return;
        ModelPriceRepository.PriceRow current = modelPrices.findActive(modelId).orElse(null);
        long base = baseCredits == null ? current == null ? 0 : current.baseCredits() : baseCredits;
        long reserve = maxReserveCredits == null ? current == null ? base : current.maxReserveCredits() : maxReserveCredits;
        if (base < 0 || reserve <= 0 || reserve < base) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "MODEL_PRICE_INVALID",
                    "模型积分价格必须满足预占积分大于 0，且不能小于实际扣除积分");
        }
        try {
            modelPrices.saveActive(new ModelPriceRepository.SaveCommand(
                    UUID.randomUUID(), modelId, "request", base, reserve, java.util.Map.of(),
                    sessionContext.userId(), expectedRowVersion
            ));
        } catch (DataAccessException exception) {
            String message = rootMessage(exception).toUpperCase(Locale.ROOT);
            if (message.contains("MODEL_PRICE_VERSION_CONFLICT")) {
                throw new ApiException(HttpStatus.CONFLICT, "MODEL_PRICE_VERSION_CONFLICT",
                        "模型价格已被其他管理员修改，请刷新后重试");
            }
            throw new ApiException(HttpStatus.CONFLICT, "MODEL_PRICE_WRITE_FAILED", "模型价格保存失败，请刷新后重试");
        }
    }


    private ModelResponse modelResponse(ModelCatalogRepository.ModelRow item) {
        var runtime = modelRuntimeConfigs == null ? java.util.Optional.<ModelRuntimeConfigRepository.RuntimeConfigRow>empty()
                : modelRuntimeConfigs.findByModelId(item.id());
        var price = modelPrices == null ? java.util.Optional.<ModelPriceRepository.PriceRow>empty()
                : modelPrices.findActive(item.id());
        return new ModelResponse(
                item.id(),
                new ModelResponse.ProviderSummary(
                        item.providerId(),
                        item.providerCode(),
                        item.providerDisplayName()
                ),
                item.code(),
                item.displayName(),
                item.capabilityType(),
                item.description(),
                item.parameterSchema(),
                item.defaultParameters(),
                item.defaultTenantEnabled(),
                item.sortOrder(),
                item.status(),
                item.createdAt(),
                item.updatedAt(),
                item.rowVersion(),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::baseUrl).orElse(null),
                runtime.isPresent(),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::submitPath).orElse(null),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::statusPath).orElse(null),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::cancelPath).orElse(null),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::timeoutSeconds).orElse(120),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::enabled).orElse(false),
                runtime.map(ModelRuntimeConfigRepository.RuntimeConfigRow::rowVersion).orElse(0L),
                price.map(ModelPriceRepository.PriceRow::baseCredits).orElse(0L),
                price.map(ModelPriceRepository.PriceRow::maxReserveCredits).orElse(0L),
                price.map(ModelPriceRepository.PriceRow::rowVersion).orElse(0L)
        );
    }
}
