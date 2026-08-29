package com.lingzhen.center.model.dto.billing;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record AdminCreditGrantRequest(
        @NotNull UUID userId,
        @Positive long credits,
        @NotBlank @Size(min = 2, max = 500) String reason,
        @NotBlank @Size(max = 160) String idempotencyKey
) {
    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
