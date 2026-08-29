package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.repository.PlatformCreditRepository;
import com.lingzhen.center.service.PlatformTaskBillingService;
import org.springframework.dao.DataAccessException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Locale;
import java.util.UUID;

@Service
public class PlatformTaskBillingServiceImpl implements PlatformTaskBillingService {
    private static final String ATTEMPT_ID = "attempt-1";
    private static final long RESERVATION_TTL_SECONDS = 2 * 60 * 60;

    private final PlatformCreditRepository credits;

    public PlatformTaskBillingServiceImpl(PlatformCreditRepository credits) {
        this.credits = credits;
    }

    @Override
    public void reserve(ReservationRequest request) {
        try {
            if (credits.findByTaskId(request.taskId().toString()).filter(row ->
                    ATTEMPT_ID.equals(row.attemptId()) && !"released".equals(row.status())).isPresent()) {
                return;
            }
            PlatformCreditRepository.PriceRow price = credits.findActivePrice(request.modelId())
                    .orElseThrow(() -> new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                            "CREDIT_PRICE_UNAVAILABLE", "当前模型暂未配置有效积分价格"));
            if (price.maxReserveCredits() <= 0 || price.baseCredits() < 0
                    || price.baseCredits() > price.maxReserveCredits()) {
                throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE,
                        "CREDIT_PRICE_INVALID", "当前模型积分价格配置无效");
            }
            String taskId = request.taskId().toString();
            credits.reserve(new PlatformCreditRepository.ReserveCommand(
                    uuid(taskId, ATTEMPT_ID, "reservation"), request.userId(), request.tenantId(),
                    taskId, ATTEMPT_ID, request.clientRequestId(), price.id(), price.maxReserveCredits(),
                    key(taskId, ATTEMPT_ID, "reserve"), Instant.now().plusSeconds(RESERVATION_TTL_SECONDS),
                    uuid(taskId, ATTEMPT_ID, "reserve-ledger")
            ));
        } catch (ApiException exception) {
            throw exception;
        } catch (DataAccessException exception) {
            throw mapReserveFailure(exception);
        }
    }

    @Override
    public void settle(UUID taskId, String resultReference) {
        try {
            PlatformCreditRepository.ReservationRow reservation = credits.findByTaskId(taskId.toString()).orElse(null);
            if (reservation == null || !"reserved".equals(reservation.status())) return;
            long charged = credits.findPriceVersion(reservation.priceVersionId())
                    .map(PlatformCreditRepository.PriceRow::baseCredits)
                    .orElseThrow(() -> new ApiException(HttpStatus.CONFLICT, "CREDIT_PRICE_SNAPSHOT_MISSING",
                            "任务积分价格快照缺失，请联系管理员处理"));
            if (charged == 0) {
                credits.release(new PlatformCreditRepository.ReleaseCommand(
                        reservation.id(), reservation.taskId(), reservation.attemptId(),
                        key(taskId.toString(), reservation.attemptId(), "release-free"),
                        uuid(taskId.toString(), reservation.attemptId(), "release-free-ledger")
                ));
                return;
            }
            if (charged < 0 || charged > reservation.reservedCredits()) {
                throw new ApiException(HttpStatus.CONFLICT, "CREDIT_SETTLEMENT_INVALID",
                        "任务积分结算金额无效，请联系管理员处理");
            }
            credits.settle(new PlatformCreditRepository.SettleCommand(
                    reservation.id(), reservation.taskId(), reservation.attemptId(), charged,
                    truncate(resultReference), key(taskId.toString(), reservation.attemptId(), "settle"),
                    uuid(taskId.toString(), reservation.attemptId(), "settlement"),
                    uuid(taskId.toString(), reservation.attemptId(), "settle-ledger")
            ));
        } catch (ApiException exception) {
            throw exception;
        } catch (DataAccessException exception) {
            throw new ApiException(HttpStatus.CONFLICT, "CREDIT_SETTLEMENT_FAILED",
                    "任务已生成但积分结算失败，请稍后重试或联系管理员");
        }
    }

    @Override
    public void release(UUID taskId) {
        try {
            PlatformCreditRepository.ReservationRow reservation = credits.findByTaskId(taskId.toString()).orElse(null);
            if (reservation == null || !"reserved".equals(reservation.status())) return;
            credits.release(new PlatformCreditRepository.ReleaseCommand(
                    reservation.id(), reservation.taskId(), reservation.attemptId(),
                    key(taskId.toString(), reservation.attemptId(), "release"),
                    uuid(taskId.toString(), reservation.attemptId(), "release-ledger")
            ));
        } catch (DataAccessException exception) {
            throw new ApiException(HttpStatus.CONFLICT, "CREDIT_RELEASE_FAILED",
                    "任务失败但积分释放失败，请稍后重试或联系管理员");
        }
    }

    private ApiException mapReserveFailure(DataAccessException exception) {
        String message = rootMessage(exception).toUpperCase(Locale.ROOT);
        if (message.contains("CREDIT_INSUFFICIENT")) {
            return new ApiException(HttpStatus.PAYMENT_REQUIRED, "CREDIT_INSUFFICIENT", "积分余额不足，请先充值");
        }
        if (message.contains("CREDIT_RESERVATION_STATE_CONFLICT")) {
            return new ApiException(HttpStatus.CONFLICT, "CREDIT_RESERVATION_STATE_CONFLICT",
                    "任务积分预占状态冲突，请刷新后重试");
        }
        return new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "CREDIT_RESERVATION_FAILED",
                "任务积分预占失败，请稍后重试");
    }

    private String rootMessage(Throwable throwable) {
        Throwable current = throwable;
        while (current.getCause() != null) current = current.getCause();
        return current.getMessage() == null ? "" : current.getMessage();
    }

    private String truncate(String value) {
        if (value == null || value.isBlank()) return null;
        return value.substring(0, Math.min(300, value.length()));
    }

    private String key(String taskId, String attemptId, String operation) {
        return "platform-task:" + taskId + ":" + attemptId + ":" + operation;
    }

    private UUID uuid(String taskId, String attemptId, String operation) {
        return UUID.nameUUIDFromBytes(key(taskId, attemptId, operation).getBytes(StandardCharsets.UTF_8));
    }
}
