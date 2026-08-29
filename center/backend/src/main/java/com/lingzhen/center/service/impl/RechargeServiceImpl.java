package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargeOrderRequest;
import com.lingzhen.center.model.dto.billing.RechargeOrderResponse;
import com.lingzhen.center.model.dto.billing.RechargeOrderListResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageListResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.RechargeRepository;
import com.lingzhen.center.service.RechargeService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class RechargeServiceImpl implements RechargeService {

    private static final String RECHARGE_PERMISSION = "credits.self.recharge";
    private static final String SANDBOX_CHANNEL = "sandbox";
    private static final String MANUAL_CHANNEL = "manual_transfer";
    private static final int MAX_IDEMPOTENCY_KEY_LENGTH = 160;
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Duration SANDBOX_ORDER_TTL = Duration.ofMinutes(30);
    private static final Duration MANUAL_ORDER_TTL = Duration.ofDays(7);
    private static final int MAX_ORDER_LIST_SIZE = 50;
    private static final DateTimeFormatter ORDER_TIME = DateTimeFormatter
            .ofPattern("yyyyMMddHHmmss")
            .withLocale(Locale.ROOT)
            .withZone(ZoneOffset.UTC);

    private final RechargeRepository repository;
    private final Clock clock;

    @Autowired
    public RechargeServiceImpl(RechargeRepository repository) {
        this(repository, Clock.systemUTC());
    }

    RechargeServiceImpl(RechargeRepository repository, Clock clock) {
        this.repository = repository;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public RechargePackageListResponse activePackages(SessionContext sessionContext) {
        requireDesktopRecharge(sessionContext);
        return new RechargePackageListResponse(repository.findPackages(true).stream()
                .map(this::packageResponse)
                .toList());
    }

    @Override
    @Transactional
    public RechargeOrderResponse createOrder(
            SessionContext sessionContext,
            String idempotencyKey,
            CreateRechargeOrderRequest request
    ) {
        requireDesktopRecharge(sessionContext);
        String normalizedKey = normalizeIdempotencyKey(idempotencyKey);
        String channel = normalizeChannel(request.paymentChannel());
        UUID proposedId = UUID.randomUUID();
        Instant now = clock.instant();
        RechargeRepository.OrderRow row;
        try {
            RechargeRepository.OrderCreateCommand command = new RechargeRepository.OrderCreateCommand(
                             proposedId,
                             orderNo(now, proposedId),
                             sessionContext.userId(),
                             request.packageId(),
                             channel,
                             normalizedKey,
                             now.plus(MANUAL_CHANNEL.equals(channel) ? MANUAL_ORDER_TTL : SANDBOX_ORDER_TTL),
                             normalizeNote(request.note())
                    );
            row = (MANUAL_CHANNEL.equals(channel)
                    ? repository.createManualOrder(command)
                    : repository.createOrder(command))
                    .orElseThrow(() -> new ApiException(
                            HttpStatus.CONFLICT,
                            "RECHARGE_ORDER_CREATE_CONFLICT",
                            "充值订单创建失败，请刷新后重试"
                    ));
        } catch (DataAccessException exception) {
            throw mapDataFailure(exception);
        }
        boolean replay = !row.id().equals(proposedId);
        if (replay && (!row.packageId().equals(request.packageId())
                || !row.paymentChannel().equals(channel))) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "CREDIT_IDEMPOTENCY_CONFLICT",
                    "该请求标识已用于其他充值内容"
            );
        }
        return orderResponse(row, replay);
    }

    @Override
    @Transactional
    public RechargeOrderResponse order(SessionContext sessionContext, UUID orderId) {
        requireDesktopRecharge(sessionContext);
        RechargeRepository.OrderRow row = repository.findUserOrder(sessionContext.userId(), orderId)
                .orElseThrow(this::orderNotFound);
        Instant now = clock.instant();
        if ("pending".equals(row.status()) && !row.expiresAt().isAfter(now)) {
            row = repository.closeOrder(row.id(), row.userId(), now, true).orElse(row);
        }
        return orderResponse(row, false);
    }

    @Override
    @Transactional(readOnly = true)
    public RechargeOrderListResponse orders(SessionContext sessionContext, int limit) {
        requireDesktopRecharge(sessionContext);
        if (limit < 1 || limit > MAX_ORDER_LIST_SIZE) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_RECHARGE_ORDER_LIMIT",
                    "充值订单查询数量必须在 1 到 50 之间"
            );
        }
        return new RechargeOrderListResponse(repository.findUserOrders(sessionContext.userId(), limit)
                .stream()
                .map(row -> orderResponse(row, false))
                .toList());
    }

    @Override
    @Transactional
    public RechargeOrderResponse cancelOrder(SessionContext sessionContext, UUID orderId) {
        requireDesktopRecharge(sessionContext);
        RechargeRepository.OrderRow current = repository.findUserOrder(sessionContext.userId(), orderId)
                .orElseThrow(this::orderNotFound);
        if ("closed".equals(current.status())) {
            return orderResponse(current, true);
        }
        if (!MANUAL_CHANNEL.equals(current.paymentChannel()) || !"manual_review".equals(current.status())) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "RECHARGE_ORDER_STATE_CONFLICT",
                    "当前充值申请不能取消"
            );
        }
        try {
            return repository.cancelManualOrder(orderId, sessionContext.userId(), clock.instant())
                    .map(row -> orderResponse(row, false))
                    .orElseThrow(this::orderNotFound);
        } catch (DataAccessException exception) {
            throw mapDataFailure(exception);
        }
    }

    private void requireDesktopRecharge(SessionContext context) {
        if (context == null
                || context.clientType() != ClientType.DESKTOP
                || !context.permissions().contains(RECHARGE_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "CREDIT_RECHARGE_FORBIDDEN",
                    "当前账号没有为本人充值积分的权限"
            );
        }
    }

    private String normalizeIdempotencyKey(String value) {
        if (value == null) {
            throw invalidIdempotencyKey();
        }
        String normalized = value.trim();
        if (normalized.length() < 8 || normalized.length() > MAX_IDEMPOTENCY_KEY_LENGTH
                || !normalized.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$")) {
            throw invalidIdempotencyKey();
        }
        return normalized;
    }

    private String normalizeChannel(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!Set.of(SANDBOX_CHANNEL, MANUAL_CHANNEL).contains(normalized)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "PAYMENT_CHANNEL_UNAVAILABLE",
                    "当前仅开放人工充值和 Sandbox 测试渠道"
            );
        }
        return normalized;
    }

    private String normalizeNote(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        return value.trim();
    }

    private String orderNo(Instant now, UUID id) {
        return "LZ" + ORDER_TIME.format(now) + id.toString().replace("-", "")
                .substring(0, 12).toUpperCase(Locale.ROOT);
    }

    private RechargePackageResponse packageResponse(RechargeRepository.PackageRow row) {
        validatePackageValues(row);
        return new RechargePackageResponse(
                row.id(), row.code(), row.displayName(), row.cashAmountCents(), row.creditAmount(),
                row.bonusCredits(), row.status(), row.sortOrder(), row.createdAt(), row.updatedAt(),
                row.rowVersion()
        );
    }

    private RechargeOrderResponse orderResponse(RechargeRepository.OrderRow row, boolean replay) {
        validateSafeValue(row.cashAmountCents(), "cashAmountCents");
        validateSafeValue(row.creditAmount(), "creditAmount");
        validateSafeValue(row.bonusCredits(), "bonusCredits");
        return new RechargeOrderResponse(
                row.id(), row.orderNo(), row.packageId(), row.packageCode(), row.cashAmountCents(),
                row.creditAmount(), row.bonusCredits(), row.paymentChannel(), row.status(),
                row.expiresAt(), row.paidAt(), row.closedAt(), row.submissionNote(), row.reviewReason(),
                row.reviewedAt(), row.createdAt(), row.updatedAt(), replay
        );
    }

    private void validatePackageValues(RechargeRepository.PackageRow row) {
        validateSafeValue(row.cashAmountCents(), "cashAmountCents");
        validateSafeValue(row.creditAmount(), "creditAmount");
        validateSafeValue(row.bonusCredits(), "bonusCredits");
        try {
            validateSafeValue(Math.addExact(row.creditAmount(), row.bonusCredits()), "totalCredits");
        } catch (ArithmeticException exception) {
            throw invalidCreditValue("totalCredits");
        }
    }

    private void validateSafeValue(long value, String field) {
        if (value < 0 || value > MAX_SAFE_INTEGER) {
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

    private ApiException invalidIdempotencyKey() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_IDEMPOTENCY_KEY",
                "充值请求标识格式不正确"
        );
    }

    private ApiException orderNotFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND,
                "RECHARGE_ORDER_NOT_FOUND",
                "充值订单不存在"
        );
    }

    private ApiException mapDataFailure(DataAccessException exception) {
        String message = rootMessage(exception).toUpperCase(Locale.ROOT);
        if (message.contains("RECHARGE_PACKAGE_NOT_ACTIVE")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "RECHARGE_PACKAGE_NOT_ACTIVE",
                    "充值套餐已停用或不存在"
            );
        }
        if (message.contains("RECHARGE_ORDER_STATE_CONFLICT")
                || message.contains("RECHARGE_ORDER_NOT_CANCELLABLE")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "RECHARGE_ORDER_STATE_CONFLICT",
                    "当前充值申请不能取消，请刷新订单状态"
            );
        }
        return new ApiException(
                HttpStatus.CONFLICT,
                "RECHARGE_ORDER_CREATE_CONFLICT",
                "充值订单创建失败，请刷新后重试"
        );
    }

    private String rootMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) {
            current = current.getCause();
        }
        return current.getMessage() == null ? "" : current.getMessage();
    }
}
