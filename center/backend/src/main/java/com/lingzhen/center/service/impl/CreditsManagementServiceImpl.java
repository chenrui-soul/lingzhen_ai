package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.ManagementCreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditReservationAnomalyPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditWalletPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementRechargeOrderPageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.CreditsManagementRepository;
import com.lingzhen.center.service.CreditsManagementService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class CreditsManagementServiceImpl implements CreditsManagementService {

    private static final String MANAGE_PERMISSION = "credits.manage";
    private static final int MAX_PAGE_SIZE = 100;
    private static final int MAX_KEYWORD_LENGTH = 120;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Duration STALE_RESERVATION_AGE = Duration.ofHours(2);

    private static final Set<String> USER_STATUSES = Set.of("pending", "active", "locked", "disabled");
    private static final Set<String> ORDER_STATUSES = Set.of(
            "pending", "paid", "closed", "rejected", "refund_pending", "refunded", "manual_review"
    );
    private static final Set<String> LEDGER_ENTRY_TYPES = Set.of(
            "migration", "recharge", "reserve", "settle", "release",
            "refund", "manual_adjustment", "reversal"
    );
    private static final Set<String> ANOMALY_TYPES = Set.of("expired", "stale");

    private final CreditsManagementRepository repository;
    private final Clock clock;

    @Autowired
    public CreditsManagementServiceImpl(CreditsManagementRepository repository) {
        this(repository, Clock.systemUTC());
    }

    CreditsManagementServiceImpl(CreditsManagementRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementCreditWalletPageResponse wallets(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String status
    ) {
        requireManagementAccess(sessionContext);
        Query query = query("wallets", cursor, limit, keyword, status, USER_STATUSES);
        List<CreditsManagementRepository.WalletRow> rows = repository.findWallets(
                query.keyword(), query.filter(), query.cursorTime(), query.cursorId(), limit + 1
        );
        Page<CreditsManagementRepository.WalletRow> page = page(rows, limit);
        List<ManagementCreditWalletPageResponse.WalletItem> items = page.items().stream()
                .map(row -> {
                    validateBalance(row.availableBalance(), "availableBalance");
                    validateBalance(row.reservedBalance(), "reservedBalance");
                    return new ManagementCreditWalletPageResponse.WalletItem(
                            row.userId(), row.username(), row.email(), row.userStatus(),
                            row.availableBalance(), row.reservedBalance(), row.createdAt(), row.updatedAt()
                    );
                })
                .toList();
        String nextCursor = page.hasNext()
                ? encodeCursor("wallets", page.items().getLast().updatedAt(), page.items().getLast().userId())
                : null;
        return new ManagementCreditWalletPageResponse(items, nextCursor);
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementRechargeOrderPageResponse orders(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String status
    ) {
        requireManagementAccess(sessionContext);
        Query query = query("orders", cursor, limit, keyword, status, ORDER_STATUSES);
        List<CreditsManagementRepository.OrderRow> rows = repository.findOrders(
                query.keyword(), query.filter(), query.cursorTime(), query.cursorId(), limit + 1
        );
        Page<CreditsManagementRepository.OrderRow> page = page(rows, limit);
        List<ManagementRechargeOrderPageResponse.OrderItem> items = page.items().stream()
                .map(row -> {
                    validateBalance(row.cashAmountCents(), "cashAmountCents");
                    validateBalance(row.creditAmount(), "creditAmount");
                    validateBalance(row.bonusCredits(), "bonusCredits");
                    return new ManagementRechargeOrderPageResponse.OrderItem(
                            row.id(), row.orderNo(), row.userId(), row.username(), row.email(),
                            row.packageCode(), row.cashAmountCents(), row.creditAmount(), row.bonusCredits(),
                            row.paymentChannel(), row.status(), row.expiresAt(), row.paidAt(), row.closedAt(),
                            row.submissionNote(), row.reviewReason(), row.reviewedAt(),
                            row.createdAt(), row.updatedAt()
                    );
                })
                .toList();
        String nextCursor = page.hasNext()
                ? encodeCursor("orders", page.items().getLast().createdAt(), page.items().getLast().id())
                : null;
        return new ManagementRechargeOrderPageResponse(items, nextCursor);
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementCreditLedgerPageResponse ledger(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String entryType
    ) {
        requireManagementAccess(sessionContext);
        Query query = query("ledger", cursor, limit, keyword, entryType, LEDGER_ENTRY_TYPES);
        List<CreditsManagementRepository.LedgerRow> rows = repository.findLedger(
                query.keyword(), query.filter(), query.cursorTime(), query.cursorId(), limit + 1
        );
        Page<CreditsManagementRepository.LedgerRow> page = page(rows, limit);
        List<ManagementCreditLedgerPageResponse.LedgerItem> items = page.items().stream()
                .map(row -> {
                    validateSignedCredit(row.availableDelta(), "availableDelta");
                    validateSignedCredit(row.reservedDelta(), "reservedDelta");
                    validateBalance(row.availableAfter(), "availableAfter");
                    validateBalance(row.reservedAfter(), "reservedAfter");
                    return new ManagementCreditLedgerPageResponse.LedgerItem(
                            row.id(), row.userId(), row.username(), row.email(), row.tenantId(), row.tenantName(),
                            row.entryType(), row.availableDelta(), row.reservedDelta(), row.availableAfter(),
                            row.reservedAfter(), row.businessType(), row.businessId(), row.reason(), row.createdAt()
                    );
                })
                .toList();
        String nextCursor = page.hasNext()
                ? encodeCursor("ledger", page.items().getLast().createdAt(), page.items().getLast().id())
                : null;
        return new ManagementCreditLedgerPageResponse(items, nextCursor);
    }

    @Override
    @Transactional(readOnly = true)
    public ManagementCreditReservationAnomalyPageResponse reservationAnomalies(
            SessionContext sessionContext,
            String cursor,
            int limit,
            String keyword,
            String anomalyType
    ) {
        requireManagementAccess(sessionContext);
        Query query = query("reservations", cursor, limit, keyword, anomalyType, ANOMALY_TYPES);
        Instant now = clock.instant();
        List<CreditsManagementRepository.ReservationAnomalyRow> rows = repository.findReservationAnomalies(
                query.keyword(), query.filter(), now, now.minus(STALE_RESERVATION_AGE),
                query.cursorTime(), query.cursorId(), limit + 1
        );
        Page<CreditsManagementRepository.ReservationAnomalyRow> page = page(rows, limit);
        List<ManagementCreditReservationAnomalyPageResponse.ReservationAnomalyItem> items = page.items().stream()
                .map(row -> {
                    validateBalance(row.reservedCredits(), "reservedCredits");
                    validateBalance(row.settledCredits(), "settledCredits");
                    validateBalance(row.releasedCredits(), "releasedCredits");
                    return new ManagementCreditReservationAnomalyPageResponse.ReservationAnomalyItem(
                            row.id(), row.userId(), row.username(), row.email(), row.tenantId(), row.tenantName(),
                            row.taskId(), row.attemptId(), row.reservedCredits(), row.settledCredits(),
                            row.releasedCredits(), row.status(), row.anomalyType(), row.expiresAt(),
                            row.createdAt(), row.updatedAt()
                    );
                })
                .toList();
        String nextCursor = page.hasNext()
                ? encodeCursor("reservations", page.items().getLast().createdAt(), page.items().getLast().id())
                : null;
        return new ManagementCreditReservationAnomalyPageResponse(items, nextCursor);
    }

    private void requireManagementAccess(SessionContext context) {
        if (context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(MANAGE_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "CREDITS_MANAGEMENT_FORBIDDEN",
                    "当前账号没有查看平台账务的权限"
            );
        }
    }

    private Query query(
            String scope,
            String cursor,
            int limit,
            String keyword,
            String filter,
            Set<String> allowedFilters
    ) {
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PAGE_REQUEST", "分页参数不正确");
        }
        String normalizedKeyword = normalizeKeyword(keyword);
        String normalizedFilter = normalizeFilter(filter, allowedFilters);
        Cursor decodedCursor = decodeCursor(scope, cursor);
        return new Query(
                normalizedKeyword,
                normalizedFilter,
                decodedCursor == null ? null : decodedCursor.createdAt(),
                decodedCursor == null ? null : decodedCursor.id()
        );
    }

    private String normalizeKeyword(String keyword) {
        if (keyword == null || keyword.isBlank()) {
            return null;
        }
        String normalized = keyword.trim();
        if (normalized.length() > MAX_KEYWORD_LENGTH) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CREDIT_FILTER", "搜索关键词过长");
        }
        return normalized;
    }

    private String normalizeFilter(String filter, Set<String> allowedFilters) {
        if (filter == null || filter.isBlank() || "all".equalsIgnoreCase(filter.trim())) {
            return null;
        }
        String normalized = filter.trim().toLowerCase(Locale.ROOT);
        if (!allowedFilters.contains(normalized)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CREDIT_FILTER", "账务筛选条件无效");
        }
        return normalized;
    }

    private Cursor decodeCursor(String expectedScope, String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", -1);
            if (parts.length != 3 || !expectedScope.equals(parts[0])) {
                throw new IllegalArgumentException("cursor scope mismatch");
            }
            return new Cursor(Instant.parse(parts[1]), UUID.fromString(parts[2]));
        } catch (RuntimeException exception) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CREDITS_MANAGEMENT_CURSOR",
                    "账务分页游标无效"
            );
        }
    }

    private String encodeCursor(String scope, Instant createdAt, UUID id) {
        String value = scope + "|" + createdAt + "|" + id;
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private <T> Page<T> page(List<T> rows, int limit) {
        boolean hasNext = rows.size() > limit;
        return new Page<>(hasNext ? rows.subList(0, limit) : rows, hasNext);
    }

    private void validateBalance(long value, String field) {
        if (value < 0 || value > MAX_SAFE_INTEGER) {
            throw invalidCreditValue(field);
        }
    }

    private void validateSignedCredit(long value, String field) {
        if (value < -MAX_SAFE_INTEGER || value > MAX_SAFE_INTEGER) {
            throw invalidCreditValue(field);
        }
    }

    private ApiException invalidCreditValue(String field) {
        return new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "CREDIT_VALUE_INVALID",
                "积分数据暂时不可用：" + field
        );
    }

    private record Cursor(Instant createdAt, UUID id) {
    }

    private record Query(String keyword, String filter, Instant cursorTime, UUID cursorId) {
    }

    private record Page<T>(List<T> items, boolean hasNext) {
    }
}
