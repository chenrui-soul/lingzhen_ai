package com.lingzhen.center.payment;

import java.time.Instant;
import java.util.UUID;

public interface PaymentAdapter {

    String channel();

    VerifiedPaymentEvent verifyAndNormalize(PaymentOrder order, PaymentNotification notification);

    record PaymentOrder(
            UUID orderId,
            String orderNo,
            String status,
            long cashAmountCents,
            Instant expiresAt
    ) {
    }

    record PaymentNotification(
            String outcome,
            String eventId,
            Long cashAmountCents,
            Instant occurredAt
    ) {
    }

    record VerifiedPaymentEvent(
            UUID orderId,
            String outcome,
            String eventId,
            String channelTradeNo,
            long cashAmountCents,
            Instant occurredAt
    ) {
    }
}
