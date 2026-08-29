package com.lingzhen.center.model.dto.auth;

import com.lingzhen.center.model.enums.ClientType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

public record LoginRequest(
        @NotBlank
        @Size(max = 320)
        String identity,

        @NotBlank
        @Size(max = 128)
        String password,

        @NotNull
        ClientType clientType,

        @NotNull
        @Valid
        DeviceRequest device
) {
}
