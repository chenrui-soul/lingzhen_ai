package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.Map;
import java.util.UUID;

public record ModelResponse(
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

    public record ProviderSummary(UUID id, String code, String displayName) {
    }
}
