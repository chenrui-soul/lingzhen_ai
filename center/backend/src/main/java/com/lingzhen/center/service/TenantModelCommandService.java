package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelPolicyResponse;
import com.lingzhen.center.model.dto.modelcatalog.UpdateTenantModelPolicyRequest;

import java.util.UUID;

public interface TenantModelCommandService {

    TenantModelPolicyResponse updatePolicy(
            SessionContext sessionContext,
            UUID modelId,
            UpdateTenantModelPolicyRequest request
    );
}
