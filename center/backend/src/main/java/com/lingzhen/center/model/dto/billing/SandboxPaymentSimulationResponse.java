package com.lingzhen.center.model.dto.billing;

public record SandboxPaymentSimulationResponse(
        String result,
        boolean idempotentReplay,
        Long availableBalance,
        RechargeOrderResponse order
) {
}
