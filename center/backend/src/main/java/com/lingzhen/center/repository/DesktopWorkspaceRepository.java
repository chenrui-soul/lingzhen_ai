package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface DesktopWorkspaceRepository {

    Optional<SnapshotRow> findSnapshot(UUID tenantId, UUID userId);

    Optional<SnapshotRow> saveSnapshot(
            UUID tenantId,
            UUID userId,
            long expectedRevision,
            Map<String, Object> snapshot,
            String contentHash
    );

    List<DoubaoAccountRow> findDoubaoAccounts(UUID tenantId, UUID userId);

    DoubaoAccountRow upsertDoubaoAccount(
            UUID tenantId,
            UUID userId,
            String accountId,
            String displayName,
            String loginState,
            String loginSummary,
            Instant lastCheckedAt
    );

    boolean removeDoubaoAccount(UUID tenantId, UUID userId, String accountId);

    List<SkillRow> findPublishedSkills(int limit);

    record SnapshotRow(long revision, Map<String, Object> snapshot, String contentHash, Instant updatedAt) {
    }

    record DoubaoAccountRow(
            String accountId,
            String displayName,
            String loginState,
            String loginSummary,
            Instant lastCheckedAt,
            Instant updatedAt,
            long rowVersion
    ) {
    }

    record SkillRow(String code, String displayName, String version, String description) {
    }
}
