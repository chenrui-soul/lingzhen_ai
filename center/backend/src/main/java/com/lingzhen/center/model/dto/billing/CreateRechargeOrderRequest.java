package com.lingzhen.center.model.dto.billing;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateRechargeOrderRequest(
        @NotNull
        UUID packageId,
        @NotBlank
        @Size(max = 32)
        String paymentChannel,
        @Size(max = 500)
        String note
) {

    public CreateRechargeOrderRequest(UUID packageId, String paymentChannel) {
        this(packageId, paymentChannel, null);
    }

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
