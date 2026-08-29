package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record TenantModelListResponse(
        boolean available,
        Long catalogVersion,
        Instant publishedAt,
        List<ModelItem> models
) {

    public record ProviderSummary(UUID id, String code, String displayName) {
    }

    public record ModelItem(
            UUID policyId,
            UUID modelId,
            ProviderSummary provider,
            String code,
            String displayName,
            String capabilityType,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            String policy,
            boolean effectiveEnabled,
            Long rowVersion
    ) {
    }
}
