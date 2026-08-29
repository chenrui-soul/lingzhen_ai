package com.lingzhen.center.model.dto.management;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record ManagementUserPageResponse(
        List<UserItem> items,
        int page,
        int pageSize,
        long total,
        int totalPages
) {

    public record UserItem(
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
}
