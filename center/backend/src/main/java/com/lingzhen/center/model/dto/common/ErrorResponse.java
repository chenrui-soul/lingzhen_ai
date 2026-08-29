package com.lingzhen.center.model.dto.common;

import java.time.Instant;
import java.util.Map;

public record ErrorResponse(
        Instant timestamp,
        String requestId,
        String code,
        String message,
        Map<String, String> fieldErrors
) {
}
