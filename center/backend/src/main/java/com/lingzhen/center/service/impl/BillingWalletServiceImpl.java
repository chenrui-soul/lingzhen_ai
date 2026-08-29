package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.CreditWalletResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.BillingWalletRepository;
import com.lingzhen.center.service.BillingWalletService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Base64;
import java.util.List;
import java.util.OptionalLong;
import java.util.UUID;

@Service
public class BillingWalletServiceImpl implements BillingWalletService {

    private static final Logger LOGGER = LoggerFactory.getLogger(BillingWalletServiceImpl.class);
    private static final String READ_PERMISSION = "credits.self.read";
    private static final int MAX_PAGE_SIZE = 100;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;

    private final BillingWalletRepository repository;

    public BillingWalletServiceImpl(BillingWalletRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional(readOnly = true)
    public CreditWalletResponse wallet(SessionContext sessionContext) {
        requireReadPermission(sessionContext);
        BillingWalletRepository.WalletRow wallet = repository.findWallet(sessionContext.userId())
                .orElseThrow(this::walletUnavailable);
        validateBalance(wallet.availableBalance(), "availableBalance");
        validateBalance(wallet.reservedBalance(), "reservedBalance");
        return new CreditWalletResponse(
                wallet.userId(),
                wallet.availableBalance(),
                wallet.reservedBalance(),
                wallet.updatedAt()
        );
    }

    @Override
    @Transactional(readOnly = true)
    public CreditLedgerPageResponse ledger(SessionContext sessionContext, String cursor, int limit) {
        requireReadPermission(sessionContext);
        if (limit < 1 || limit > MAX_PAGE_SIZE) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_PAGE_REQUEST", "分页参数不正确");
        }
        LedgerCursor ledgerCursor = decodeCursor(cursor);
        List<BillingWalletRepository.LedgerRow> rows = repository.findLedger(
                sessionContext.userId(),
                ledgerCursor == null ? null : ledgerCursor.createdAt(),
                ledgerCursor == null ? null : ledgerCursor.id(),
                limit + 1
        );
        boolean hasNext = rows.size() > limit;
        List<BillingWalletRepository.LedgerRow> visibleRows = hasNext ? rows.subList(0, limit) : rows;
        List<CreditLedgerPageResponse.LedgerItem> items = visibleRows.stream()
                .map(this::ledgerItem)
                .toList();
        String nextCursor = hasNext ? encodeCursor(visibleRows.getLast()) : null;
        return new CreditLedgerPageResponse(items, nextCursor);
    }

    @Override
    @Transactional(readOnly = true)
    public OptionalLong availableBalanceForBootstrap(SessionContext sessionContext) {
        if (sessionContext.clientType() != ClientType.DESKTOP
                || !sessionContext.permissions().contains(READ_PERMISSION)) {
            return OptionalLong.empty();
        }
        try {
            return repository.findWallet(sessionContext.userId())
                    .map(wallet -> {
                        validateBalance(wallet.availableBalance(), "availableBalance");
                        return OptionalLong.of(wallet.availableBalance());
                    })
                    .orElseGet(OptionalLong::empty);
        } catch (DataAccessException exception) {
            LOGGER.warn("Billing wallet is unavailable for desktop bootstrap: userId={}", sessionContext.userId());
            return OptionalLong.empty();
        }
    }

    private CreditLedgerPageResponse.LedgerItem ledgerItem(BillingWalletRepository.LedgerRow row) {
        validateSignedCredit(row.availableDelta(), "availableDelta");
        validateSignedCredit(row.reservedDelta(), "reservedDelta");
        validateBalance(row.availableAfter(), "availableAfter");
        validateBalance(row.reservedAfter(), "reservedAfter");
        return new CreditLedgerPageResponse.LedgerItem(
                row.id(),
                row.tenantId(),
                row.entryType(),
                row.availableDelta(),
                row.reservedDelta(),
                row.availableAfter(),
                row.reservedAfter(),
                row.businessType(),
                row.businessId(),
                row.reason(),
                row.createdAt()
        );
    }

    private void requireReadPermission(SessionContext context) {
        if (context.clientType() != ClientType.DESKTOP
                || !context.permissions().contains(READ_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "CREDIT_WALLET_READ_FORBIDDEN",
                    "当前账号没有查看本人积分的权限"
            );
        }
    }

    private LedgerCursor decodeCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String decoded = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
            int separator = decoded.lastIndexOf('|');
            if (separator < 1 || separator == decoded.length() - 1) {
                throw new IllegalArgumentException("cursor separator is missing");
            }
            return new LedgerCursor(
                    Instant.parse(decoded.substring(0, separator)),
                    UUID.fromString(decoded.substring(separator + 1))
            );
        } catch (RuntimeException exception) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_CREDIT_LEDGER_CURSOR",
                    "积分流水游标无效"
            );
        }
    }

    private String encodeCursor(BillingWalletRepository.LedgerRow row) {
        String value = row.createdAt() + "|" + row.id();
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString(value.getBytes(StandardCharsets.UTF_8));
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

    private ApiException walletUnavailable() {
        return new ApiException(
                HttpStatus.SERVICE_UNAVAILABLE,
                "CREDIT_WALLET_UNAVAILABLE",
                "积分钱包暂时不可用"
        );
    }

    private record LedgerCursor(Instant createdAt, UUID id) {
    }
}
