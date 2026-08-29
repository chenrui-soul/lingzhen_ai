package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface TenantModelRepository {

    Optional<TenantCatalog> findCurrentCatalog(UUID tenantId, boolean onlyEffectiveModels);

    Optional<Boolean> findCurrentModelDefault(UUID modelId);

    Optional<PolicyRow> findPolicy(UUID tenantId, UUID modelId);

    PolicyRow createPolicy(PolicyCreateCommand command);

    Optional<PolicyRow> updatePolicy(PolicyUpdateCommand command);

    record TenantCatalog(long version, Instant publishedAt, List<ModelRow> models) {
    }

    record ModelRow(
            UUID policyId,
            UUID modelId,
            UUID providerId,
            String providerCode,
            String providerDisplayName,
            String code,
            String displayName,
            String capabilityType,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            String policy,
            boolean effectiveEnabled,
            Long rowVersion
    ) {
    }

    record PolicyCreateCommand(
            UUID id,
            UUID tenantId,
            UUID modelId,
            String policy,
            UUID updatedByMembershipId
    ) {
    }

    record PolicyUpdateCommand(
            UUID id,
            UUID tenantId,
            UUID modelId,
            String policy,
            UUID updatedByMembershipId,
            long rowVersion
    ) {
    }

    record PolicyRow(
            UUID id,
            UUID tenantId,
            UUID modelId,
            String policy,
            UUID updatedByMembershipId,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) {
    }
}
