package com.lingzhen.center.model.dto.auth;

import jakarta.validation.constraints.Size;

public record RefreshRequest(
        @Size(max = 512)
        String refreshToken
) {
}
