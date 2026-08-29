package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.management.ManagementDashboardResponse;
import com.lingzhen.center.model.dto.management.ManagementTenantResponse;
import com.lingzhen.center.model.dto.management.ManagementUserPageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ManagementReadRepository;
import com.lingzhen.center.service.ManagementReadService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Set;

@Service
public class ManagementReadServiceImpl implements ManagementReadService {

    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_KEYWORD_LENGTH = 100;
    private static final Set<String> MEMBER_STATUSES = Set.of(
            "invited",
            "active",
            "suspended",
            "removed"
    );

    private final ManagementReadRepository repository;
    private final Clock clock;

    public ManagementReadServiceImpl(ManagementReadRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementDashboardResponse dashboard(SessionContext sessionContext) {
        requirePermission(sessionContext, "tenant.read");
        Instant now = clock.instant();
        ManagementReadRepository.DashboardSnapshot snapshot = repository
                .findDashboard(sessionContext.tenantId(), now)
                .orElseThrow(this::tenantNotFound);
        return new ManagementDashboardResponse(
                now,
                new ManagementDashboardResponse.ManagementDashboardTenantSummary(
                        snapshot.tenantId(),
                        snapshot.tenantCode(),
                        snapshot.tenantName(),
                        snapshot.tenantStatus()
                ),
                new ManagementDashboardResponse.ManagementDashboardMetrics(
                        snapshot.totalMembers(),
                        snapshot.activeMembers(),
                        snapshot.suspendedMembers(),
                        snapshot.activeSessions()
                ),
                snapshot.roles().stream()
                        .map(role -> new ManagementDashboardResponse.ManagementDashboardRoleSummary(
                                role.code(),
                                role.name(),
                                role.members()
                        ))
                        .toList()
        );
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementUserPageResponse users(
            SessionContext sessionContext,
            int page,
            int pageSize,
            String keyword,
            String status
    ) {
        requirePermission(sessionContext, "membership.read");
        validatePage(page, pageSize);
        String normalizedKeyword = normalizeKeyword(keyword);
        String normalizedStatus = normalizeStatus(status);
        ManagementReadRepository.MemberPage result = repository.findMembers(
                sessionContext.tenantId(),
                normalizedKeyword,
                normalizedStatus,
                (page - 1) * pageSize,
                pageSize,
                clock.instant()
        );
        int totalPages = result.total() == 0
                ? 0
                : (int) Math.ceil((double) result.total() / pageSize);
        return new ManagementUserPageResponse(
                result.items().stream()
                        .map(item -> new ManagementUserPageResponse.UserItem(
                                item.membershipId(),
                                item.userId(),
                                item.username(),
                                item.email(),
                                item.userStatus(),
                                item.membershipStatus(),
                                item.roleCode(),
                                item.roleName(),
                                item.joinedAt(),
                                item.lastLoginAt(),
                                item.activeSessions()
                        ))
                        .toList(),
                page,
                pageSize,
                result.total(),
                totalPages
        );
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementTenantResponse tenant(SessionContext sessionContext) {
        requirePermission(sessionContext, "tenant.read");
        ManagementReadRepository.TenantSnapshot snapshot = repository
                .findTenant(sessionContext.tenantId(), clock.instant())
                .orElseThrow(this::tenantNotFound);
        return new ManagementTenantResponse(
                snapshot.id(),
                snapshot.code(),
                snapshot.name(),
                snapshot.status(),
                snapshot.createdAt(),
                new ManagementTenantResponse.ManagementTenantMetrics(
                        snapshot.totalMembers(),
                        snapshot.activeMembers(),
                        snapshot.suspendedMembers(),
                        snapshot.activeSessions()
                )
        );
    }

    private void requirePermission(SessionContext context, String permission) {
        if (context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(permission)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "MANAGEMENT_READ_FORBIDDEN",
                    "当前账号没有查看此管理数据的权限"
            );
        }
    }

    private void validatePage(int page, int pageSize) {
        if (page < 1 || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_PAGE_REQUEST",
                    "分页参数不正确"
            );
        }
    }

    private String normalizeKeyword(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return null;
        }
        String normalized = keyword.trim();
        if (normalized.length() > MAX_KEYWORD_LENGTH) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "SEARCH_KEYWORD_TOO_LONG",
                    "搜索内容不能超过 100 个字符"
            );
        }
        return normalized;
    }

    private String normalizeStatus(String status) {
        if (status == null || status.isBlank() || "all".equalsIgnoreCase(status)) {
            return null;
        }
        String normalized = status.trim().toLowerCase(Locale.ROOT);
        if (!MEMBER_STATUSES.contains(normalized)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_MEMBER_STATUS",
                    "成员状态筛选值不正确"
            );
        }
        return normalized;
    }

    private ApiException tenantNotFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND,
                "TENANT_NOT_FOUND",
                "当前租户不存在或已不可用"
        );
    }
}
