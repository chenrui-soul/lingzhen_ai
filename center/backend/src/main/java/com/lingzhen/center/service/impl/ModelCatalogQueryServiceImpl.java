package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionDetailResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderPageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.model.enums.ModelCapabilityType;
import com.lingzhen.center.model.enums.ModelCatalogStatus;
import com.lingzhen.center.repository.ModelCatalogRepository;
import com.lingzhen.center.repository.ModelPriceRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
import com.lingzhen.center.service.ModelCatalogQueryService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class ModelCatalogQueryServiceImpl implements ModelCatalogQueryService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_KEYWORD_LENGTH = 100;
    private static final String READ_PERMISSION = "model_catalog.read";

    private final ModelCatalogRepository repository;
    private final ModelRuntimeConfigRepository runtimeConfigs;
    private final ModelPriceRepository modelPrices;

    public ModelCatalogQueryServiceImpl(ModelCatalogRepository repository) {
        this(repository, null, null);
    }

    public ModelCatalogQueryServiceImpl(ModelCatalogRepository repository,
                                        ModelRuntimeConfigRepository runtimeConfigs) {
        this(repository, runtimeConfigs, null);
    }

    @org.springframework.beans.factory.annotation.Autowired
    public ModelCatalogQueryServiceImpl(ModelCatalogRepository repository,
                                        ModelRuntimeConfigRepository runtimeConfigs,
                                        ModelPriceRepository modelPrices) {
        this.repository = repository;
        this.runtimeConfigs = runtimeConfigs;
        this.modelPrices = modelPrices;
    }

    @Override
    @Transactional(readOnly = true)
    public ModelProviderPageResponse providers(
            SessionContext sessionContext,
            int page,
            int pageSize
    ) {
        requirePermission(sessionContext);
        validatePage(page, pageSize);
        ModelCatalogRepository.ProviderPage result = repository.findProviders(
                (page - 1) * pageSize,
                pageSize
        );
        return new ModelProviderPageResponse(
                result.items().stream()
                        .map(item -> new ModelProviderPageResponse.ProviderItem(
                                item.id(),
                                item.code(),
                                item.displayName(),
                                item.protocolFamily(),
                                item.description(),
                                item.status(),
                                item.createdAt(),
                                item.updatedAt(),
                                item.rowVersion()
                        ))
                        .toList(),
                page,
                pageSize,
                result.total(),
                totalPages(result.total(), pageSize)
        );
    }

    @Override
    @Transactional(readOnly = true)
    public ModelPageResponse models(
            SessionContext sessionContext,
            int page,
            int pageSize,
            String keyword,
            String status,
            String capabilityType,
            UUID providerId
    ) {
        requirePermission(sessionContext);
        validatePage(page, pageSize);
        ModelCatalogRepository.ModelPage result = repository.findModels(
                normalizeKeyword(keyword),
                normalizeStatus(status),
                normalizeCapability(capabilityType),
                providerId,
                (page - 1) * pageSize,
                pageSize
        );
        return new ModelPageResponse(
                result.items().stream()
                        .map(item -> {
                            var runtime = runtimeConfigs == null
                                    ? java.util.Optional.<ModelRuntimeConfigRepository.RuntimeConfigRow>empty()
                                    : runtimeConfigs.findByModelId(item.id());
                            var price = modelPrices == null
                                    ? java.util.Optional.<ModelPriceRepository.PriceRow>empty()
                                    : modelPrices.findActive(item.id());
                            return new ModelPageResponse.ModelItem(
                                item.id(),
                                new ModelPageResponse.ProviderSummary(
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
                        })
                        .toList(),
                page,
                pageSize,
                result.total(),
                totalPages(result.total(), pageSize)
        );
    }

    @Override
    @Transactional(readOnly = true)
    public CatalogVersionPageResponse versions(
            SessionContext sessionContext,
            int page,
            int pageSize
    ) {
        requirePermission(sessionContext);
        validatePage(page, pageSize);
        ModelCatalogRepository.VersionPage result = repository.findVersions(
                (page - 1) * pageSize,
                pageSize
        );
        return new CatalogVersionPageResponse(
                result.items().stream()
                        .map(item -> new CatalogVersionPageResponse.VersionItem(
                                item.id(),
                                item.version(),
                                item.current(),
                                item.contentHash(),
                                item.publishedByUserId(),
                                item.publishedByMembershipId(),
                                item.publishedAt(),
                                item.createdAt(),
                                item.modelCount()
                        ))
                        .toList(),
                page,
                pageSize,
                result.total(),
                totalPages(result.total(), pageSize)
        );
    }

    @Override
    @Transactional(readOnly = true)
    public CatalogVersionDetailResponse version(SessionContext sessionContext, UUID versionId) {
        requirePermission(sessionContext);
        if (versionId == null) {
            throw invalidVersionId();
        }
        ModelCatalogRepository.VersionDetail result = repository.findVersion(versionId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "MODEL_CATALOG_VERSION_NOT_FOUND",
                        "模型目录版本不存在"
                ));
        ModelCatalogRepository.VersionRow version = result.version();
        return new CatalogVersionDetailResponse(
                version.id(),
                version.version(),
                version.current(),
                version.contentHash(),
                version.publishedByUserId(),
                version.publishedByMembershipId(),
                version.publishedAt(),
                version.createdAt(),
                result.models().stream()
                        .map(item -> new CatalogVersionDetailResponse.ModelItem(
                                item.modelId(),
                                new CatalogVersionDetailResponse.ProviderSummary(
                                        item.providerId(),
                                        item.providerCode(),
                                        item.providerDisplayName(),
                                        item.providerProtocolFamily()
                                ),
                                item.code(),
                                item.displayName(),
                                item.capabilityType(),
                                item.description(),
                                item.parameterSchema(),
                                item.defaultParameters(),
                                item.defaultTenantEnabled(),
                                item.sortOrder()
                        ))
                        .toList()
        );
    }

    private void requirePermission(SessionContext context) {
        if (context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(READ_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "MODEL_CATALOG_READ_FORBIDDEN",
                    "当前账号没有查看平台模型目录的权限"
            );
        }
    }

    private void validatePage(int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_PAGE_REQUEST",
                    "分页参数不正确"
            );
        }
    }

    private String normalizeKeyword(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return null;
        }
        String normalized = keyword.trim();
        if (normalized.length() > MAX_KEYWORD_LENGTH) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "SEARCH_KEYWORD_TOO_LONG",
                    "搜索内容不能超过 100 个字符"
            );
        }
        return normalized;
    }

    private String normalizeStatus(String status) {
        if (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) {
            return null;
        }
        return ModelCatalogStatus.find(status)
                .map(ModelCatalogStatus::value)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_MODEL_STATUS",
                        "模型状态筛选值不正确"
                ));
    }

    private String normalizeCapability(String capabilityType) {
        if (capabilityType == null
                || capabilityType.isBlank()
                || "all".equalsIgnoreCase(capabilityType)) {
            return null;
        }
        return ModelCapabilityType.find(capabilityType)
                .map(ModelCapabilityType::value)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_MODEL_CAPABILITY",
                        "模型能力类型筛选值不正确"
                ));
    }

    private int totalPages(long total, int pageSize) {
        return total == 0 ? 0 : (int) Math.ceil((double) total / pageSize);
    }

    private ApiException invalidVersionId() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_MODEL_CATALOG_VERSION_ID",
                "模型目录版本标识不正确"
        );
    }
}
