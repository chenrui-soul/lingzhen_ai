package com.lingzhen.center.model.dto.auth;

import com.lingzhen.center.model.enums.ClientType;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

public record RegisterRequest(
        @NotBlank
        @Size(min = 3, max = 64)
        @Pattern(regexp = "^[A-Za-z0-9._-]+$")
        String username,

        @NotBlank
        @Email
        @Size(max = 320)
        String email,

        @NotBlank
        @Size(min = 12, max = 128)
        String password,

        @Size(max = 512)
        String invitationToken,

        @NotNull
        ClientType clientType,

        @NotNull
        @Valid
        DeviceRequest device
) {
}
