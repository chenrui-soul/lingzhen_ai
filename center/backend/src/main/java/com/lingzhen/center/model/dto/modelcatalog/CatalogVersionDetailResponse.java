package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record CatalogVersionDetailResponse(
        UUID id,
        long version,
        boolean current,
        String contentHash,
        UUID publishedByUserId,
        UUID publishedByMembershipId,
        Instant publishedAt,
        Instant createdAt,
        List<ModelItem> models
) {

    public record ProviderSummary(
            UUID id,
            String code,
            String displayName,
            String protocolFamily
    ) {
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
            int sortOrder
    ) {
    }
}
