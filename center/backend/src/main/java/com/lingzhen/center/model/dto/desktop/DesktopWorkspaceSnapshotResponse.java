package com.lingzhen.center.model.dto.desktop;

import java.time.Instant;
import java.util.Map;

public record DesktopWorkspaceSnapshotResponse(
        long revision,
        Map<String, Object> snapshot,
        String contentHash,
        Instant updatedAt
) {
}
