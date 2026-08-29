package com.lingzhen.center.model.dto.auth;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record SelectTenantRequest(
        @NotBlank
        @Size(max = 512)
        String tenantSelectionTicket,

        @NotNull
        UUID tenantId,

        @NotNull
        @Valid
        DeviceRequest device
) {
}
