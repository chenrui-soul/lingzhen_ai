package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ModelProviderPageResponse(
        List<ProviderItem> items,
        int page,
        int pageSize,
        long total,
        int totalPages
) {

    public record ProviderItem(
            UUID id,
            String code,
            String displayName,
            String protocolFamily,
            String description,
            String status,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) {
    }
}
