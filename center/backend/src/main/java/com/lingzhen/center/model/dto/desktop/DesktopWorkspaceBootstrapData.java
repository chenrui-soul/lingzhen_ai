package com.lingzhen.center.model.dto.desktop;

import java.time.Instant;
import java.util.List;

public record DesktopWorkspaceBootstrapData(
        List<DesktopDoubaoAccountResponse> doubaoAccounts,
        List<RecentProjectSummary> recentProjects,
        List<SkillSummary> skills
) {
    public record RecentProjectSummary(String id, String name, Instant updatedAt) {
    }

    public record SkillSummary(String code, String displayName, String version, String description) {
    }
}
