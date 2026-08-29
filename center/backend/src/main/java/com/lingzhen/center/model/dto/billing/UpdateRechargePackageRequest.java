package com.lingzhen.center.model.dto.billing;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record UpdateRechargePackageRequest(
        @NotBlank
        @Size(max = 120)
        String displayName,
        @Positive
        long cashAmountCents,
        @Positive
        long creditAmount,
        @PositiveOrZero
        long bonusCredits,
        @NotBlank
        @Size(max = 16)
        String status,
        int sortOrder,
        @NotNull
        @PositiveOrZero
        Long rowVersion
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
