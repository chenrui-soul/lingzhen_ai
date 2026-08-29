package com.lingzhen.center.payment;

import com.lingzhen.center.exception.ApiException;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class SandboxPaymentAdapterTest {

    private final SandboxPaymentAdapter adapter = new SandboxPaymentAdapter();

    @Test
    void normalizesPaidEventAndUsesOrderAmountByDefault() {
        UUID orderId = UUID.randomUUID();
        Instant now = Instant.parse("2026-08-26T00:00:00Z");

        PaymentAdapter.VerifiedPaymentEvent event = adapter.verifyAndNormalize(
                new PaymentAdapter.PaymentOrder(
                        orderId, "LZ202608260001", "pending", 990, now.plusSeconds(900)
                ),
                new PaymentAdapter.PaymentNotification(" PAID ", "event-0001", null, now)
        );

        assertThat(event.orderId()).isEqualTo(orderId);
        assertThat(event.outcome()).isEqualTo("paid");
        assertThat(event.cashAmountCents()).isEqualTo(990);
        assertThat(event.channelTradeNo()).isEqualTo("SBX-event-0001");
    }

    @Test
    void rejectsUnknownOutcomeAndUnsafeEventId() {
        PaymentAdapter.PaymentOrder order = new PaymentAdapter.PaymentOrder(
                UUID.randomUUID(), "LZ202608260001", "pending", 990,
                Instant.parse("2026-08-26T01:00:00Z")
        );

        assertThatThrownBy(() -> adapter.verifyAndNormalize(
                order,
                new PaymentAdapter.PaymentNotification(
                        "refunded", "event-0001", null, Instant.parse("2026-08-26T00:00:00Z")
                )
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("PAYMENT_CALLBACK_INVALID"));

        assertThatThrownBy(() -> adapter.verifyAndNormalize(
                order,
                new PaymentAdapter.PaymentNotification(
                        "paid", "../bad", null, Instant.parse("2026-08-26T00:00:00Z")
                )
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("PAYMENT_CALLBACK_INVALID"));
    }
}
