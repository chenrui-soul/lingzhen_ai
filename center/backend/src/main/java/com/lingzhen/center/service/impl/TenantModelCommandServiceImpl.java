package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelPolicyResponse;
import com.lingzhen.center.model.dto.modelcatalog.UpdateTenantModelPolicyRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.model.enums.TenantModelPolicy;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.service.TenantModelCommandService;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class TenantModelCommandServiceImpl implements TenantModelCommandService {

    private static final String MANAGE_PERMISSION = "tenant_model.manage";

    private final TenantModelRepository repository;

    public TenantModelCommandServiceImpl(TenantModelRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public TenantModelPolicyResponse updatePolicy(
            SessionContext sessionContext,
            UUID modelId,
            UpdateTenantModelPolicyRequest request
    ) {
        requirePermission(sessionContext);
        if (modelId == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TENANT_MODEL_ID",
                    "模型标识不正确"
            );
        }
        TenantModelPolicy policy = policy(request.policy());
        boolean defaultEnabled = repository.findCurrentModelDefault(modelId)
                .orElseThrow(() -> new ApiException(
                        HttpStatus.NOT_FOUND,
                        "TENANT_MODEL_NOT_IN_CURRENT_CATALOG",
                        "该模型不在当前发布目录中"
                ));

        TenantModelRepository.PolicyRow current = repository
                .findPolicy(sessionContext.tenantId(), modelId)
                .orElse(null);
        if (current == null) {
            if (request.rowVersion() != null) {
                throw rowVersionConflict();
            }
            if (policy == TenantModelPolicy.INHERIT) {
                return response(null, modelId, policy.value(), defaultEnabled, null, null);
            }
            return createPolicy(sessionContext, modelId, policy, defaultEnabled);
        }

        if (request.rowVersion() == null || current.rowVersion() != request.rowVersion()) {
            throw rowVersionConflict();
        }
        if (current.policy().equals(policy.value())) {
            return response(
                    current.id(),
                    current.modelId(),
                    current.policy(),
                    effectiveEnabled(defaultEnabled, current.policy()),
                    current.rowVersion(),
                    current.updatedAt()
            );
        }

        TenantModelRepository.PolicyRow updated = repository.updatePolicy(
                        new TenantModelRepository.PolicyUpdateCommand(
                                current.id(),
                                sessionContext.tenantId(),
                                modelId,
                                policy.value(),
                                sessionContext.membershipId(),
                                request.rowVersion()
                        ))
                .orElseThrow(this::rowVersionConflict);
        return response(
                updated.id(),
                updated.modelId(),
                updated.policy(),
                effectiveEnabled(defaultEnabled, updated.policy()),
                updated.rowVersion(),
                updated.updatedAt()
        );
    }

    private TenantModelPolicyResponse createPolicy(
            SessionContext context,
            UUID modelId,
            TenantModelPolicy policy,
            boolean defaultEnabled
    ) {
        try {
            TenantModelRepository.PolicyRow created = repository.createPolicy(
                    new TenantModelRepository.PolicyCreateCommand(
                            UUID.randomUUID(),
                            context.tenantId(),
                            modelId,
                            policy.value(),
                            context.membershipId()
                    )
            );
            return response(
                    created.id(),
                    created.modelId(),
                    created.policy(),
                    effectiveEnabled(defaultEnabled, created.policy()),
                    created.rowVersion(),
                    created.updatedAt()
            );
        } catch (DataIntegrityViolationException exception) {
            throw rowVersionConflict();
        }
    }

    private void requirePermission(SessionContext context) {
        if (context == null
                || context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(MANAGE_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "TENANT_MODEL_MANAGE_FORBIDDEN",
                    "当前账号没有维护租户模型策略的权限"
            );
        }
    }

    private TenantModelPolicy policy(String value) {
        try {
            return TenantModelPolicy.fromValue(value);
        } catch (IllegalArgumentException exception) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_TENANT_MODEL_POLICY",
                    "租户模型策略不正确"
            );
        }
    }

    private boolean effectiveEnabled(boolean defaultEnabled, String policy) {
        return switch (policy) {
            case "enabled" -> true;
            case "hidden" -> false;
            default -> defaultEnabled;
        };
    }

    private TenantModelPolicyResponse response(
            UUID policyId,
            UUID modelId,
            String policy,
            boolean effectiveEnabled,
            Long rowVersion,
            java.time.Instant updatedAt
    ) {
        return new TenantModelPolicyResponse(
                policyId,
                modelId,
                policy,
                effectiveEnabled,
                rowVersion,
                updatedAt
        );
    }

    private ApiException rowVersionConflict() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "TENANT_MODEL_ROW_VERSION_CONFLICT",
                "租户模型策略已被其他操作更新，请刷新后重试"
        );
    }
}
