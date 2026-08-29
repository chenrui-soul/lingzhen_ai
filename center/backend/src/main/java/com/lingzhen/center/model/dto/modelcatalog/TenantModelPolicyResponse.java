package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.UUID;

public record TenantModelPolicyResponse(
        UUID policyId,
        UUID modelId,
        String policy,
        boolean effectiveEnabled,
        Long rowVersion,
        Instant updatedAt
) {
}
