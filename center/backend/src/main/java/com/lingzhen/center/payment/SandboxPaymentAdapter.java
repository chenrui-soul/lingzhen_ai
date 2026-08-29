package com.lingzhen.center.payment;

import com.lingzhen.center.exception.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

import java.util.Locale;
import java.util.Set;

@Component
public class SandboxPaymentAdapter implements PaymentAdapter {

    private static final Set<String> OUTCOMES = Set.of("paid", "failed", "cancelled");

    @Override
    public String channel() {
        return "sandbox";
    }

    @Override
    public VerifiedPaymentEvent verifyAndNormalize(
            PaymentOrder order,
            PaymentNotification notification
    ) {
        if (order == null || notification == null || notification.occurredAt() == null) {
            throw invalidCallback();
        }
        String outcome = normalize(notification.outcome());
        if (!OUTCOMES.contains(outcome)) {
            throw invalidCallback();
        }
        String eventId = normalizeEventId(notification.eventId());
        long amount = notification.cashAmountCents() == null
                ? order.cashAmountCents()
                : notification.cashAmountCents();
        if (amount <= 0) {
            throw invalidCallback();
        }
        String tradeNo = "paid".equals(outcome) ? "SBX-" + eventId : null;
        return new VerifiedPaymentEvent(
                order.orderId(), outcome, eventId, tradeNo, amount, notification.occurredAt()
        );
    }

    private String normalize(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private String normalizeEventId(String value) {
        if (value == null) {
            throw invalidCallback();
        }
        String normalized = value.trim();
        if (normalized.length() < 8 || normalized.length() > 120
                || !normalized.matches("^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$")) {
            throw invalidCallback();
        }
        return normalized;
    }

    private ApiException invalidCallback() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "PAYMENT_CALLBACK_INVALID",
                "Sandbox 支付事件格式不正确"
        );
    }
}
