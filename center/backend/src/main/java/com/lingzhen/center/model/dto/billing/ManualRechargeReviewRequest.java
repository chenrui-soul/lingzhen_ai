package com.lingzhen.center.model.dto.billing;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ManualRechargeReviewRequest(
        @NotBlank
        @Size(min = 2, max = 500)
        String reason
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}

