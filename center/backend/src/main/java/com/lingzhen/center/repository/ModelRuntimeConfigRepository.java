package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.Optional;
import java.util.UUID;

public interface ModelRuntimeConfigRepository {
    Optional<RuntimeConfigRow> findByModelId(UUID modelId);
    RuntimeConfigRow upsert(UpsertCommand command);

    record UpsertCommand(
            UUID modelId,
            String baseUrl,
            String apiKeyCiphertext,
            String submitPath,
            String statusPath,
            String cancelPath,
            int timeoutSeconds,
            boolean enabled,
            Long rowVersion
    ) { }

    record RuntimeConfigRow(
            UUID modelId,
            String baseUrl,
            String apiKeyCiphertext,
            String submitPath,
            String statusPath,
            String cancelPath,
            int timeoutSeconds,
            boolean enabled,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) { }
}
