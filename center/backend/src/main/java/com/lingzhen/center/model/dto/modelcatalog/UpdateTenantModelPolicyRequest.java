package com.lingzhen.center.model.dto.modelcatalog;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;

public record UpdateTenantModelPolicyRequest(
        @NotBlank
        @Pattern(regexp = "^(inherit|enabled|hidden)$")
        String policy,
        @PositiveOrZero Long rowVersion
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
