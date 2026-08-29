package com.lingzhen.center.model.dto.desktop;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

public record DesktopWorkspaceSnapshotRequest(
        @Min(0) long expectedRevision,
        @NotNull Map<String, Object> snapshot
) {
}
