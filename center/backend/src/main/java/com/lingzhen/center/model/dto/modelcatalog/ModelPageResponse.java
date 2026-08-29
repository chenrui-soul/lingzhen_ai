package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ModelPageResponse(
        List<ModelItem> items,
        int page,
        int pageSize,
        long total,
        int totalPages
) {

    public record ProviderSummary(UUID id, String code, String displayName) {
    }

    public record ModelItem(
            UUID id,
            ProviderSummary provider,
            String code,
            String displayName,
            String capabilityType,
            String description,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder,
            String status,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion,
            String baseUrl,
            boolean apiKeyConfigured,
            String submitPath,
            String statusPath,
            String cancelPath,
            int timeoutSeconds,
            boolean runtimeEnabled,
            long runtimeRowVersion,
            long baseCredits,
            long maxReserveCredits,
            long priceRowVersion
    ) {
    }
}
