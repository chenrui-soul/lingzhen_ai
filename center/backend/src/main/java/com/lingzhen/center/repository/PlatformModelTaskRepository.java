package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface PlatformModelTaskRepository {

    Optional<TaskRow> findOwned(UUID tenantId, UUID userId, UUID taskId);

    Optional<TaskRow> findByClientRequestId(UUID tenantId, UUID userId, String clientRequestId);

    List<TaskRow> findOwnedRecoverable(UUID tenantId, UUID userId, int limit);

    Optional<TaskRow> create(CreateCommand command);

    Optional<TaskRow> update(UpdateCommand command);

    record CreateCommand(
            UUID id,
            UUID tenantId,
            UUID userId,
            UUID modelId,
            String providerCode,
            String creationType,
            String clientRequestId,
            String state
    ) {
    }

    record UpdateCommand(
            UUID id,
            UUID tenantId,
            UUID userId,
            String state,
            String providerJobId,
            List<String> resultUrls,
            String resultText,
            String errorCode,
            String errorMessage,
            long rowVersion
    ) {
    }

    record TaskRow(
            UUID id,
            UUID tenantId,
            UUID userId,
            UUID modelId,
            String providerCode,
            String creationType,
            String clientRequestId,
            String state,
            String providerJobId,
            List<String> resultUrls,
            String resultText,
            String errorCode,
            String errorMessage,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) {
    }
}
