package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record CatalogVersionPageResponse(
        List<VersionItem> items,
        int page,
        int pageSize,
        long total,
        int totalPages
) {

    public record VersionItem(
            UUID id,
            long version,
            boolean current,
            String contentHash,
            UUID publishedByUserId,
            UUID publishedByMembershipId,
            Instant publishedAt,
            Instant createdAt,
            long modelCount
    ) {
    }
}
