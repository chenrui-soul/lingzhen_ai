package com.lingzhen.center.model.dto.billing;

public record ManualRechargeReviewResponse(
        String result,
        boolean idempotentReplay,
        Long availableBalance,
        RechargeOrderResponse order
) {
}

