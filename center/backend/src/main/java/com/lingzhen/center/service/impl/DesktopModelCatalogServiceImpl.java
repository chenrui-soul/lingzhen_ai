package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.config.PlatformProxyProperties;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopBootstrapResponse;
import com.lingzhen.center.model.dto.desktop.DesktopModelCatalogResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.repository.ModelRuntimeConfigRepository;
import com.lingzhen.center.service.DesktopModelCatalogService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class DesktopModelCatalogServiceImpl implements DesktopModelCatalogService {

    private static final String MODEL_USE_PERMISSION = "model.use";
    private static final String BOOTSTRAP_PERMISSION = "desktop.bootstrap";

    private final TenantModelRepository repository;
    private final PlatformProxyProperties platformProxyProperties;
    private final ModelRuntimeConfigRepository runtimeConfigs;

    public DesktopModelCatalogServiceImpl(
            TenantModelRepository repository,
            PlatformProxyProperties platformProxyProperties,
            ModelRuntimeConfigRepository runtimeConfigs
    ) {
        this.repository = repository;
        this.platformProxyProperties = platformProxyProperties;
        this.runtimeConfigs = runtimeConfigs;
    }

    @Override
    @Transactional(readOnly = true)
    public DesktopModelCatalogResponse load(SessionContext sessionContext) {
        requirePermission(sessionContext, MODEL_USE_PERMISSION, "DESKTOP_MODEL_READ_FORBIDDEN");
        return loadCatalog(sessionContext);
    }

    @Override
    @Transactional(readOnly = true)
    public DesktopModelCatalogResponse loadForBootstrap(SessionContext sessionContext) {
        requirePermission(sessionContext, BOOTSTRAP_PERMISSION, "DESKTOP_BOOTSTRAP_FORBIDDEN");
        return loadCatalog(sessionContext);
    }

    private DesktopModelCatalogResponse loadCatalog(SessionContext sessionContext) {
        return repository.findCurrentCatalog(sessionContext.tenantId(), true)
                .map(catalog -> new DesktopModelCatalogResponse(
                        new DesktopBootstrapResponse.ModelCatalogSummary(
                                true,
                                catalog.version(),
                                catalog.publishedAt()
                        ),
                        catalog.models().stream()
                                .map(item -> new DesktopBootstrapResponse.PlatformModelSummary(
                                        item.modelId(),
                                        "platform",
                                        new DesktopBootstrapResponse.PlatformProviderSummary(
                                                item.providerId(),
                                                item.providerCode(),
                                                item.providerDisplayName()
                                        ),
                                        item.code(),
                                        item.displayName(),
                                        item.capabilityType(),
                                        item.parameterSchema(),
                                        item.defaultParameters(),
                                        catalog.version(),
                                        executionReady(item.modelId())
                                ))
                                .toList()
                ))
                .orElseGet(() -> new DesktopModelCatalogResponse(
                        new DesktopBootstrapResponse.ModelCatalogSummary(false, null, null),
                        List.of()
                ));
    }

    private boolean executionReady(java.util.UUID modelId) {
        if (!platformProxyProperties.isEnabled()) {
            return false;
        }
        return runtimeConfigs.findByModelId(modelId)
                .filter(config -> config.enabled()
                        && config.baseUrl() != null
                        && !config.baseUrl().isBlank()
                        && config.apiKeyCiphertext() != null
                        && !config.apiKeyCiphertext().isBlank())
                .isPresent();
    }

    private void requirePermission(SessionContext context, String permission, String errorCode) {
        if (context.clientType() != ClientType.DESKTOP
                || !context.permissions().contains(permission)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    errorCode,
                    "当前账号没有查看桌面模型目录的权限"
            );
        }
    }
}
