package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargePackageRequest;
import com.lingzhen.center.model.dto.billing.AdminCreditGrantRequest;
import com.lingzhen.center.model.dto.billing.AdminCreditGrantResponse;
import com.lingzhen.center.model.dto.billing.ManualRechargeReviewRequest;
import com.lingzhen.center.model.dto.billing.ManualRechargeReviewResponse;
import com.lingzhen.center.model.dto.billing.RechargeOrderResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageListResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageResponse;
import com.lingzhen.center.model.dto.billing.SandboxPaymentSimulationRequest;
import com.lingzhen.center.model.dto.billing.SandboxPaymentSimulationResponse;
import com.lingzhen.center.model.dto.billing.UpdateRechargePackageRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.payment.PaymentAdapter;
import com.lingzhen.center.payment.SandboxPaymentAdapter;
import com.lingzhen.center.repository.RechargeRepository;
import com.lingzhen.center.service.RechargeManagementService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Clock;
import java.time.Instant;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
public class RechargeManagementServiceImpl implements RechargeManagementService {

    private static final Logger LOGGER = LoggerFactory.getLogger(RechargeManagementServiceImpl.class);
    private static final String MANAGE_PERMISSION = "credits.manage";
    private static final long MAX_SAFE_INTEGER = 9_007_199_254_740_991L;
    private static final Set<String> PACKAGE_STATUSES = Set.of("draft", "active", "inactive");

    private final RechargeRepository repository;
    private final SandboxPaymentAdapter sandboxPaymentAdapter;
    private final Clock clock;

    @Autowired
    public RechargeManagementServiceImpl(
            RechargeRepository repository,
            SandboxPaymentAdapter sandboxPaymentAdapter
    ) {
        this(repository, sandboxPaymentAdapter, Clock.systemUTC());
    }

    RechargeManagementServiceImpl(
            RechargeRepository repository,
            SandboxPaymentAdapter sandboxPaymentAdapter,
            Clock clock
    ) {
        this.repository = repository;
        this.sandboxPaymentAdapter = sandboxPaymentAdapter;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public RechargePackageListResponse packages(SessionContext sessionContext) {
        requireManagementAccess(sessionContext);
        return new RechargePackageListResponse(repository.findPackages(false).stream()
                .map(this::packageResponse)
                .toList());
    }

    @Override
    @Transactional
    public RechargePackageResponse createPackage(
            SessionContext sessionContext,
            CreateRechargePackageRequest request
    ) {
        requireManagementAccess(sessionContext);
        validateAmounts(request.cashAmountCents(), request.creditAmount(), request.bonusCredits());
        try {
            RechargeRepository.PackageRow row = repository.createPackage(
                            new RechargeRepository.PackageCreateCommand(
                                    UUID.randomUUID(),
                                    request.code().trim().toLowerCase(Locale.ROOT),
                                    request.displayName().trim(),
                                    request.cashAmountCents(),
                                    request.creditAmount(),
                                    request.bonusCredits(),
                                    request.sortOrder(),
                                    sessionContext.userId()
                            ))
                    .orElseThrow(() -> packageCodeConflict());
            return packageResponse(row);
        } catch (DataAccessException exception) {
            throw mapDataFailure(exception);
        }
    }

    @Override
    @Transactional
    public RechargePackageResponse updatePackage(
            SessionContext sessionContext,
            UUID packageId,
            UpdateRechargePackageRequest request
    ) {
        requireManagementAccess(sessionContext);
        validateAmounts(request.cashAmountCents(), request.creditAmount(), request.bonusCredits());
        String status = normalizeStatus(request.status());
        RechargeRepository.PackageRow current = repository.findPackage(packageId)
                .orElseThrow(this::packageNotFound);
        if (current.rowVersion() != request.rowVersion()) {
            throw packageVersionConflict();
        }
        try {
            return repository.updatePackage(new RechargeRepository.PackageUpdateCommand(
                            packageId,
                            request.displayName().trim(),
                            request.cashAmountCents(),
                            request.creditAmount(),
                            request.bonusCredits(),
                            status,
                            request.sortOrder(),
                            request.rowVersion()
                    ))
                    .map(this::packageResponse)
                    .orElseThrow(this::packageVersionConflict);
        } catch (DataAccessException exception) {
            throw mapDataFailure(exception);
        }
    }

    @Override
    @Transactional
    public SandboxPaymentSimulationResponse simulateSandboxPayment(
            SessionContext sessionContext,
            UUID orderId,
            SandboxPaymentSimulationRequest request
    ) {
        requireManagementAccess(sessionContext);
        RechargeRepository.OrderRow order = repository.findOrder(orderId)
                .orElseThrow(this::orderNotFound);
        if (!sandboxPaymentAdapter.channel().equals(order.paymentChannel())) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "PAYMENT_CHANNEL_MISMATCH",
                    "该订单不是 Sandbox 支付订单"
            );
        }

        Instant now = clock.instant();
        if ("pending".equals(order.status()) && !order.expiresAt().isAfter(now)) {
            RechargeRepository.OrderRow closed = repository.closeOrder(
                    order.id(), order.userId(), now, true
            ).orElse(order);
            return response("expired", false, null, closed);
        }

        PaymentAdapter.VerifiedPaymentEvent event = sandboxPaymentAdapter.verifyAndNormalize(
                new PaymentAdapter.PaymentOrder(
                        order.id(), order.orderNo(), order.status(), order.cashAmountCents(), order.expiresAt()
                ),
                new PaymentAdapter.PaymentNotification(
                        request.outcome(), request.eventId(), request.cashAmountCents(), now
                )
        );

        if ("paid".equals(event.outcome())) {
            if (event.cashAmountCents() != order.cashAmountCents()) {
                throw new ApiException(
                        HttpStatus.CONFLICT,
                        "PAYMENT_AMOUNT_MISMATCH",
                        "支付金额与订单金额不一致"
                );
            }
            try {
                RechargeRepository.PaymentApplyResult result = repository.applySandboxPayment(
                        new RechargeRepository.PaymentApplyCommand(
                                order.id(), event.channelTradeNo(), event.eventId(),
                                event.cashAmountCents(), event.occurredAt(), UUID.randomUUID()
                        )
                );
                RechargeRepository.OrderRow updated = repository.findOrder(order.id())
                        .orElseThrow(this::orderNotFound);
                String resultName = "closed".equals(result.orderStatus()) ? "expired" : "paid";
                LOGGER.info(
                        "Sandbox payment processed: orderId={}, result={}, replay={}",
                        order.id(), resultName, result.idempotentReplay()
                );
                return response(
                        resultName,
                        result.idempotentReplay(),
                        result.availableBalance(),
                        updated
                );
            } catch (DataAccessException exception) {
                throw mapPaymentFailure(exception);
            }
        }

        if ("paid".equals(order.status())) {
            throw orderStateConflict();
        }
        if ("closed".equals(order.status())) {
            return response(order.status(), true, null, order);
        }
        RechargeRepository.OrderRow closed = repository.closeOrder(
                order.id(), order.userId(), event.occurredAt(), false
        ).orElseThrow(this::orderStateConflict);
        LOGGER.info(
                "Sandbox payment closed: orderId={}, outcome={}",
                order.id(), event.outcome()
        );
        return response(event.outcome(), false, null, closed);
    }

    @Override
    @Transactional
    public ManualRechargeReviewResponse approveManualRecharge(
            SessionContext sessionContext,
            UUID orderId,
            ManualRechargeReviewRequest request
    ) {
        requireManagementAccess(sessionContext);
        String reason = normalizeReviewReason(request.reason());
        requireManualOrder(orderId);
        try {
            RechargeRepository.PaymentApplyResult result = repository.approveManualRecharge(
                    new RechargeRepository.ManualReviewCommand(
                            orderId,
                            sessionContext.userId(),
                            reason,
                            clock.instant(),
                            UUID.randomUUID()
                    )
            );
            RechargeRepository.OrderRow updated = repository.findOrder(orderId)
                    .orElseThrow(this::orderNotFound);
            LOGGER.info(
                    "Manual recharge approved: orderId={}, replay={}",
                    orderId,
                    result.idempotentReplay()
            );
            return manualResponse(
                    "approved",
                    result.idempotentReplay(),
                    result.availableBalance(),
                    updated
            );
        } catch (DataAccessException exception) {
            throw mapManualReviewFailure(exception);
        }
    }

    @Override
    @Transactional
    public ManualRechargeReviewResponse rejectManualRecharge(
            SessionContext sessionContext,
            UUID orderId,
            ManualRechargeReviewRequest request
    ) {
        requireManagementAccess(sessionContext);
        String reason = normalizeReviewReason(request.reason());
        RechargeRepository.OrderRow order = requireManualOrder(orderId);
        if ("rejected".equals(order.status())) {
            return manualResponse("rejected", true, null, order);
        }
        try {
            RechargeRepository.OrderRow updated = repository.rejectManualRecharge(
                            new RechargeRepository.ManualReviewCommand(
                                    orderId,
                                    sessionContext.userId(),
                                    reason,
                                    clock.instant(),
                                    null
                            ))
                    .orElseThrow(this::orderStateConflict);
            LOGGER.info("Manual recharge rejected: orderId={}", orderId);
            return manualResponse("rejected", false, null, updated);
        } catch (DataAccessException exception) {
            throw mapManualReviewFailure(exception);
        }
    }

    @Override
    @Transactional
    public AdminCreditGrantResponse grantCredits(
            SessionContext sessionContext,
            AdminCreditGrantRequest request
    ) {
        requireManagementAccess(sessionContext);
        if (request.credits() <= 0 || request.credits() > MAX_SAFE_INTEGER) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CREDIT_GRANT", "充值积分数量不正确");
        }
        String key = request.idempotencyKey().trim();
        if (key.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CREDIT_GRANT", "充值请求标识不能为空");
        }
        try {
            RechargeRepository.PaymentApplyResult result = repository.grantAdminCredits(
                    new RechargeRepository.ManualGrantCommand(
                            request.userId(), sessionContext.userId(), request.credits(),
                            request.reason().trim(), key, UUID.randomUUID()
                    )
            );
            return new AdminCreditGrantResponse(
                    result.orderStatus(), result.idempotentReplay(),
                    result.availableBalance(), result.reservedBalance()
            );
        } catch (DataAccessException exception) {
            String message = rootMessage(exception).toUpperCase(Locale.ROOT);
            if (message.contains("CREDIT_WALLET_UNAVAILABLE")) {
                throw new ApiException(HttpStatus.NOT_FOUND, "CREDIT_USER_NOT_FOUND", "目标用户不存在或钱包未初始化");
            }
            if (message.contains("CREDIT_VALUE_INVALID")) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CREDIT_GRANT", "充值积分数量超出安全范围");
            }
            throw new ApiException(HttpStatus.CONFLICT, "CREDIT_GRANT_CONFLICT", "充值未完成，请刷新后重试");
        }
    }

    private RechargeRepository.OrderRow requireManualOrder(UUID orderId) {
        RechargeRepository.OrderRow order = repository.findOrder(orderId)
                .orElseThrow(this::orderNotFound);
        if (!"manual_transfer".equals(order.paymentChannel())) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "PAYMENT_CHANNEL_MISMATCH",
                    "该订单不是人工充值申请"
            );
        }
        return order;
    }

    private String normalizeReviewReason(String value) {
        String normalized = value == null ? "" : value.trim();
        if (normalized.length() < 2 || normalized.length() > 500) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_MANUAL_RECHARGE_REASON",
                    "审核说明长度必须在 2 到 500 个字符之间"
            );
        }
        return normalized;
    }

    private void requireManagementAccess(SessionContext context) {
        if (context == null
                || context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(MANAGE_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "CREDITS_MANAGEMENT_FORBIDDEN",
                    "当前账号没有维护平台充值业务的权限"
            );
        }
    }

    private String normalizeStatus(String value) {
        String normalized = value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
        if (!PACKAGE_STATUSES.contains(normalized)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_RECHARGE_PACKAGE_STATUS",
                    "充值套餐状态不正确"
            );
        }
        return normalized;
    }

    private void validateAmounts(long cashAmount, long creditAmount, long bonusCredits) {
        if (cashAmount <= 0 || cashAmount > MAX_SAFE_INTEGER
                || creditAmount <= 0 || creditAmount > MAX_SAFE_INTEGER
                || bonusCredits < 0 || bonusCredits > MAX_SAFE_INTEGER) {
            throw invalidPackageAmount();
        }
        try {
            long total = Math.addExact(creditAmount, bonusCredits);
            if (total > MAX_SAFE_INTEGER) {
                throw invalidPackageAmount();
            }
        } catch (ArithmeticException exception) {
            throw invalidPackageAmount();
        }
    }

    private RechargePackageResponse packageResponse(RechargeRepository.PackageRow row) {
        validateAmounts(row.cashAmountCents(), row.creditAmount(), row.bonusCredits());
        return new RechargePackageResponse(
                row.id(), row.code(), row.displayName(), row.cashAmountCents(), row.creditAmount(),
                row.bonusCredits(), row.status(), row.sortOrder(), row.createdAt(), row.updatedAt(),
                row.rowVersion()
        );
    }

    private SandboxPaymentSimulationResponse response(
            String result,
            boolean replay,
            Long availableBalance,
            RechargeRepository.OrderRow row
    ) {
        return new SandboxPaymentSimulationResponse(
                result,
                replay,
                availableBalance,
                orderResponse(row, replay)
        );
    }

    private ManualRechargeReviewResponse manualResponse(
            String result,
            boolean replay,
            Long availableBalance,
            RechargeRepository.OrderRow row
    ) {
        return new ManualRechargeReviewResponse(
                result,
                replay,
                availableBalance,
                orderResponse(row, replay)
        );
    }

    private RechargeOrderResponse orderResponse(RechargeRepository.OrderRow row, boolean replay) {
        return new RechargeOrderResponse(
                row.id(), row.orderNo(), row.packageId(), row.packageCode(), row.cashAmountCents(),
                row.creditAmount(), row.bonusCredits(), row.paymentChannel(), row.status(),
                row.expiresAt(), row.paidAt(), row.closedAt(), row.submissionNote(), row.reviewReason(),
                row.reviewedAt(), row.createdAt(), row.updatedAt(), replay
        );
    }

    private ApiException invalidPackageAmount() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_RECHARGE_PACKAGE_AMOUNT",
                "充值套餐金额或积分数量不正确"
        );
    }

    private ApiException packageNotFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND,
                "RECHARGE_PACKAGE_NOT_FOUND",
                "充值套餐不存在"
        );
    }

    private ApiException packageCodeConflict() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "RECHARGE_PACKAGE_CODE_CONFLICT",
                "充值套餐代码已存在"
        );
    }

    private ApiException packageVersionConflict() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "RECHARGE_PACKAGE_ROW_VERSION_CONFLICT",
                "套餐已被其他管理员修改，请刷新后重试"
        );
    }

    private ApiException orderNotFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND,
                "RECHARGE_ORDER_NOT_FOUND",
                "充值订单不存在"
        );
    }

    private ApiException orderStateConflict() {
        return new ApiException(
                HttpStatus.CONFLICT,
                "RECHARGE_ORDER_STATE_CONFLICT",
                "充值订单当前状态不允许执行该操作"
        );
    }

    private ApiException mapDataFailure(DataAccessException exception) {
        String message = rootMessage(exception).toLowerCase(Locale.ROOT);
        if (message.contains("recharge_packages_code_uk")) {
            return packageCodeConflict();
        }
        return new ApiException(
                HttpStatus.CONFLICT,
                "RECHARGE_PACKAGE_WRITE_CONFLICT",
                "充值套餐保存失败，请刷新后重试"
        );
    }

    private ApiException mapPaymentFailure(DataAccessException exception) {
        String message = rootMessage(exception).toUpperCase(Locale.ROOT);
        if (message.contains("PAYMENT_AMOUNT_MISMATCH")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "PAYMENT_AMOUNT_MISMATCH",
                    "支付金额与订单金额不一致"
            );
        }
        if (message.contains("RECHARGE_ORDER_NOT_FOUND")) {
            return orderNotFound();
        }
        if (message.contains("RECHARGE_ORDER_STATE_CONFLICT")) {
            return orderStateConflict();
        }
        if (message.contains("CREDIT_VALUE_INVALID")) {
            return new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "CREDIT_VALUE_INVALID",
                    "积分余额超出安全范围"
            );
        }
        if (message.contains("RECHARGE_ORDERS_CHANNEL_TRADE_UX")
                || message.contains("CREDIT_LEDGER_ENTRIES_BUSINESS_IDEMPOTENCY_UK")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "CREDIT_IDEMPOTENCY_CONFLICT",
                    "该 Sandbox 支付事件已用于其他订单"
            );
        }
        return new ApiException(
                HttpStatus.CONFLICT,
                "PAYMENT_CALLBACK_INVALID",
                "Sandbox 支付事件未能通过账务校验"
        );
    }

    private ApiException mapManualReviewFailure(DataAccessException exception) {
        String message = rootMessage(exception).toUpperCase(Locale.ROOT);
        if (message.contains("RECHARGE_ORDER_NOT_FOUND")) {
            return orderNotFound();
        }
        if (message.contains("PAYMENT_CHANNEL_MISMATCH")) {
            return new ApiException(
                    HttpStatus.CONFLICT,
                    "PAYMENT_CHANNEL_MISMATCH",
                    "该订单不是人工充值申请"
            );
        }
        if (message.contains("RECHARGE_ORDER_STATE_CONFLICT")) {
            return orderStateConflict();
        }
        if (message.contains("CREDIT_VALUE_INVALID")) {
            return new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "CREDIT_VALUE_INVALID",
                    "积分余额超出安全范围"
            );
        }
        return new ApiException(
                HttpStatus.CONFLICT,
                "MANUAL_RECHARGE_REVIEW_CONFLICT",
                "人工充值审核未能通过账务校验"
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
