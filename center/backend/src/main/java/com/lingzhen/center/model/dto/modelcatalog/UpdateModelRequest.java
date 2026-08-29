package com.lingzhen.center.model.dto.modelcatalog;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.PositiveOrZero;
import jakarta.validation.constraints.Size;

import java.util.Map;
import java.util.UUID;

public record UpdateModelRequest(
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
        @NotNull
        Boolean defaultTenantEnabled,
        @NotNull
        @PositiveOrZero
        Integer sortOrder,
        @NotBlank
        @Size(max = 16)
        String status,
        @NotNull
        @PositiveOrZero
        Long rowVersion
        ,
        @Size(max = 2048) String baseUrl,
        @Size(max = 4096) String apiKey,
        @Size(max = 512) String submitPath,
        @Size(max = 512) String statusPath,
        @Size(max = 512) String cancelPath,
        Integer timeoutSeconds,
        Boolean runtimeEnabled,
        @PositiveOrZero Long runtimeRowVersion,
        @PositiveOrZero Long baseCredits,
        @PositiveOrZero Long maxReserveCredits,
        @PositiveOrZero Long priceRowVersion
) {

    public UpdateModelRequest(
            UUID providerId, String code, String displayName, String capabilityType,
            String description, Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters, Boolean defaultTenantEnabled,
            Integer sortOrder, String status, Long rowVersion
    ) {
        this(providerId, code, displayName, capabilityType, description, parameterSchema,
                defaultParameters, defaultTenantEnabled, sortOrder, status, rowVersion,
                null, null, null, null, null, null, null, null, null, null, null);
    }

    /**
     * Backward-compatible runtime configuration constructor.
     * Price fields were added after the runtime contract; callers that do not
     * manage model pricing continue to use this overload with null price data.
     */
    public UpdateModelRequest(
            UUID providerId, String code, String displayName, String capabilityType,
            String description, Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters, Boolean defaultTenantEnabled,
            Integer sortOrder, String status, Long rowVersion,
            String baseUrl, String apiKey, String submitPath, String statusPath,
            String cancelPath, Integer timeoutSeconds, Boolean runtimeEnabled,
            Long runtimeRowVersion
    ) {
        this(providerId, code, displayName, capabilityType, description, parameterSchema,
                defaultParameters, defaultTenantEnabled, sortOrder, status, rowVersion,
                baseUrl, apiKey, submitPath, statusPath, cancelPath, timeoutSeconds,
                runtimeEnabled, runtimeRowVersion, null, null, null);
    }

    @JsonAnySetter
    public void rejectUnknownField(String fieldName, Object ignoredValue) {
        throw new IllegalArgumentException("Unsupported request field: " + fieldName);
    }
}
