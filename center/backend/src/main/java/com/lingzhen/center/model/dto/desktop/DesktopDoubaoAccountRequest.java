package com.lingzhen.center.model.dto.desktop;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;

import java.time.Instant;

public record DesktopDoubaoAccountRequest(
        @NotBlank @Size(max = 100) String displayName,
        @NotBlank @Pattern(regexp = "unknown|logged_in|logged_out|verification_required") String loginState,
        @Size(max = 300) String loginSummary,
        Instant lastCheckedAt
) {
}
