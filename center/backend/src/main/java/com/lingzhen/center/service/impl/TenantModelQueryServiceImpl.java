package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelListResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.service.TenantModelQueryService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class TenantModelQueryServiceImpl implements TenantModelQueryService {

    private static final String READ_PERMISSION = "tenant_model.read";

    private final TenantModelRepository repository;

    public TenantModelQueryServiceImpl(TenantModelRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
    public TenantModelListResponse models(SessionContext sessionContext) {
        requirePermission(sessionContext);
        return repository.findCurrentCatalog(sessionContext.tenantId(), false)
                .map(catalog -> new TenantModelListResponse(
                        true,
                        catalog.version(),
                        catalog.publishedAt(),
                        catalog.models().stream()
                                .map(item -> new TenantModelListResponse.ModelItem(
                                        item.policyId(),
                                        item.modelId(),
                                        new TenantModelListResponse.ProviderSummary(
                                                item.providerId(),
                                                item.providerCode(),
                                                item.providerDisplayName()
                                        ),
                                        item.code(),
                                        item.displayName(),
                                        item.capabilityType(),
                                        item.parameterSchema(),
                                        item.defaultParameters(),
                                        item.defaultTenantEnabled(),
                                        item.policy(),
                                        item.effectiveEnabled(),
                                        item.rowVersion()
                                ))
                                .toList()
                ))
                .orElseGet(() -> new TenantModelListResponse(false, null, null, List.of()));
    }

    private void requirePermission(SessionContext context) {
        if (context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(READ_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "TENANT_MODEL_READ_FORBIDDEN",
                    "当前账号没有查看租户模型策略的权限"
            );
        }
    }
}
