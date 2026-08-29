package com.lingzhen.center.model.dto.modelcatalog;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.Map;
import java.util.UUID;

public record CreateModelRequest(
        @NotNull
        UUID providerId,
        @NotBlank
        @Pattern(regexp = "^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
        String code,
        @NotBlank
        @Size(max = 160)
        String displayName,
        @NotBlank
        @Size(max = 16)
        String capabilityType,
        @Size(max = 4000)
        String description,
        @NotNull
        Map<String, Object> parameterSchema,
        @NotNull
        Map<String, Object> defaultParameters,
        Boolean defaultTenantEnabled,
        @PositiveOrZero Integer sortOrder,
        @Size(max = 2048) String baseUrl,
        @Size(max = 4096) String apiKey,
        @Size(max = 512) String submitPath,
        @Size(max = 512) String statusPath,
        @Size(max = 512) String cancelPath,
        Integer timeoutSeconds,
        Boolean runtimeEnabled,
        @PositiveOrZero Long baseCredits,
        @PositiveOrZero Long maxReserveCredits
) {

    public CreateModelRequest(
            UUID providerId, String code, String displayName, String capabilityType,
            String description, Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters, Boolean defaultTenantEnabled, Integer sortOrder
    ) {
        this(providerId, code, displayName, capabilityType, description, parameterSchema,
                defaultParameters, defaultTenantEnabled, sortOrder,
                null, null, null, null, null, null, null, null, null);
    }

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
