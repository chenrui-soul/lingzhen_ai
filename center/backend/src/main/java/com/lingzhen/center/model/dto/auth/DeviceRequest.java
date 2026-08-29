package com.lingzhen.center.model.dto.auth;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record DeviceRequest(
        @NotBlank
        @Pattern(regexp = "^[0-9a-f]{64}$")
        String deviceHash,

        @Min(1)
        @Max(32767)
        int fingerprintVersion,

        @Size(max = 160)
        String displayName,

        @Size(max = 32)
        String platform,

        @Size(max = 32)
        String architecture,

        @Size(max = 32)
        String appVersion
) {
}
