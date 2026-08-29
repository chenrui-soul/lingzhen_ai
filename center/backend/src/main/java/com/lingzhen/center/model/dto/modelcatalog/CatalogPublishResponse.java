package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.UUID;

public record CatalogPublishResponse(
        UUID versionId,
        long version,
        boolean current,
        int modelCount,
        Instant publishedAt,
        boolean idempotentReplay
) {
}
