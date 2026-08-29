package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface ManagementReadRepository {

    Optional<DashboardSnapshot> findDashboard(UUID tenantId, Instant now);

    MemberPage findMembers(
            UUID tenantId,
            String keyword,
            String status,
            int offset,
            int limit,
            Instant now
    );

    Optional<TenantSnapshot> findTenant(UUID tenantId, Instant now);

    record DashboardSnapshot(
            UUID tenantId,
            String tenantCode,
            String tenantName,
            String tenantStatus,
            long totalMembers,
            long activeMembers,
            long suspendedMembers,
            long activeSessions,
            List<RoleCount> roles
    ) {
    }

    record RoleCount(String code, String name, long members) {
    }

    record MemberPage(List<MemberRow> items, long total) {
    }

    record MemberRow(
            UUID membershipId,
            UUID userId,
            String username,
            String email,
            String userStatus,
            String membershipStatus,
            String roleCode,
            String roleName,
            Instant joinedAt,
            Instant lastLoginAt,
            long activeSessions
    ) {
    }

    record TenantSnapshot(
            UUID id,
            String code,
            String name,
            String status,
            Instant createdAt,
            long totalMembers,
            long activeMembers,
            long suspendedMembers,
            long activeSessions
    ) {
    }
}
