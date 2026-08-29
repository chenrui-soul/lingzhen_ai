package com.lingzhen.center.model.dto.billing;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;
import jakarta.validation.constraints.Pattern;

public record CreateRechargePackageRequest(
        @NotBlank
        @Size(max = 64)
        @Pattern(regexp = "^[a-z][a-z0-9_.-]{2,63}$")
        String code,
        @NotBlank
        @Size(max = 120)
        String displayName,
        @Positive
        long cashAmountCents,
        @Positive
        long creditAmount,
        @PositiveOrZero
        long bonusCredits,
        int sortOrder
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
