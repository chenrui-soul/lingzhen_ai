package com.lingzhen.center.model.dto.modelcatalog;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record CreateModelProviderRequest(
        @NotBlank
        @Pattern(regexp = "^[a-z][a-z0-9_.-]{1,63}$")
        String code,
        @NotBlank
        @Size(max = 120)
        String displayName,
        @NotBlank
        @Size(max = 32)
        String protocolFamily,
        @Size(max = 2000)
        String description
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
