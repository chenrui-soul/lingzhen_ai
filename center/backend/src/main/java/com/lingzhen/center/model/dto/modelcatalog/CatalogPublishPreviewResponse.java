package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.List;

public record CatalogPublishPreviewResponse(
        Long currentVersion,
        Instant currentPublishedAt,
        long nextVersion,
        int modelCount,
        int addedCount,
        int modifiedCount,
        int removedCount,
        boolean hasChanges,
        boolean canPublish,
        String contentHash,
        List<Blocker> blockers
) {

    public record Blocker(String code, String message) {
    }
}
