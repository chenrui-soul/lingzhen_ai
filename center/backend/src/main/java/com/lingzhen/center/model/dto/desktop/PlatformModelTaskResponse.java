package com.lingzhen.center.model.dto.desktop;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public record PlatformModelTaskResponse(
        UUID taskId,
        UUID modelId,
        String providerCode,
        String state,
        String providerJobId,
        List<String> resultUrls,
        String resultText,
        String errorCode,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt
) {
    public PlatformModelTaskResponse {
        resultUrls = resultUrls == null ? List.of() : List.copyOf(resultUrls);
    }
}
