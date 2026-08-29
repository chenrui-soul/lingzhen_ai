package com.lingzhen.center.model.dto.modelcatalog;

import java.time.Instant;
import java.util.UUID;

public record ModelProviderResponse(
        UUID id,
        String code,
        String displayName,
        String protocolFamily,
        String description,
        String status,
        Instant createdAt,
        Instant updatedAt,
        long rowVersion
) {
}
