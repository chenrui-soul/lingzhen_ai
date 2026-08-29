package com.lingzhen.center.model.dto.modelcatalog;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

public record UpdateModelProviderRequest(
        @NotBlank
        @Size(max = 120)
        String displayName,
        @NotBlank
        @Size(max = 32)
        String protocolFamily,
        @Size(max = 2000)
        String description,
        @NotBlank
        @Size(max = 16)
        String status,
        @NotNull
        @PositiveOrZero
        Long rowVersion
) {

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
