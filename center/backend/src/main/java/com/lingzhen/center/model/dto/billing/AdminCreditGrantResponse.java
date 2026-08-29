package com.lingzhen.center.model.dto.billing;

public record AdminCreditGrantResponse(
        String result,
        boolean idempotentReplay,
        long availableBalance,
        long reservedBalance
) {}
