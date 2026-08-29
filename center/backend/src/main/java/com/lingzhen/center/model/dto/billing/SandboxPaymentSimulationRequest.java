package com.lingzhen.center.model.dto.billing;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record SandboxPaymentSimulationRequest(
        @NotBlank
        @Size(max = 16)
        String outcome,
        @NotBlank
        @Size(max = 120)
        @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:-]{7,119}$")
        String eventId,
        @Positive
        Long cashAmountCents
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
