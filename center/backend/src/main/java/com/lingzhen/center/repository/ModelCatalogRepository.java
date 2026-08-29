package com.lingzhen.center.repository;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface ModelCatalogRepository {

    ProviderPage findProviders(int offset, int limit);

    Optional<ProviderRow> findProvider(UUID providerId);

    Optional<ProviderRow> createProvider(ProviderCreateCommand command);

    Optional<ProviderRow> updateProvider(ProviderUpdateCommand command);

    boolean providerHasActiveModels(UUID providerId);

    ModelPage findModels(
            String keyword,
            String status,
            String capabilityType,
            UUID providerId,
            int offset,
            int limit
    );

    Optional<ModelRow> findModel(UUID modelId);

    Optional<ModelRow> createModel(ModelCreateCommand command);

    Optional<ModelRow> updateModel(ModelUpdateCommand command);

    VersionPage findVersions(int offset, int limit);

    Optional<VersionDetail> findVersion(UUID versionId);

    Optional<VersionDetail> findCurrentVersion();

    Optional<VersionDetail> findVersionByIdempotencyKey(String idempotencyKey);

    List<VersionModelRow> findPublishableModels();

    void acquirePublicationLock();

    long nextVersionNumber();

    void createVersionHeader(VersionCreateCommand command);

    void insertVersionItems(UUID versionId, List<VersionModelRow> models);

    void sealVersion(UUID versionId, Instant publishedAt);

    void replaceCurrentVersion(UUID versionId);

    record ProviderPage(List<ProviderRow> items, long total) {
    }

    record ProviderCreateCommand(
            UUID id,
            String code,
            String displayName,
            String protocolFamily,
            String description
    ) {
    }

    record ProviderUpdateCommand(
            UUID id,
            String displayName,
            String protocolFamily,
            String description,
            String status,
            long rowVersion
    ) {
    }

    record ProviderRow(
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

    record ModelPage(List<ModelRow> items, long total) {
    }

    record ModelCreateCommand(
            UUID id,
            UUID providerId,
            String code,
            String displayName,
            String capabilityType,
            String description,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder
    ) {
    }

    record ModelUpdateCommand(
            UUID id,
            UUID providerId,
            String code,
            String displayName,
            String capabilityType,
            String description,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder,
            String status,
            long rowVersion
    ) {
    }

    record ModelRow(
            UUID id,
            UUID providerId,
            String providerCode,
            String providerDisplayName,
            String code,
            String displayName,
            String capabilityType,
            String description,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder,
            String status,
            Instant createdAt,
            Instant updatedAt,
            long rowVersion
    ) {
    }

    record VersionPage(List<VersionRow> items, long total) {
    }

    record VersionCreateCommand(
            UUID id,
            long version,
            String contentHash,
            String idempotencyKey,
            UUID publishedByUserId,
            UUID publishedByMembershipId
    ) {
    }

    record VersionRow(
            UUID id,
            long version,
            boolean current,
            String contentHash,
            UUID publishedByUserId,
            UUID publishedByMembershipId,
            Instant publishedAt,
            Instant createdAt,
            long modelCount
    ) {
    }

    record VersionDetail(VersionRow version, List<VersionModelRow> models) {
    }

    record VersionModelRow(
            UUID modelId,
            UUID providerId,
            String providerCode,
            String providerDisplayName,
            String providerProtocolFamily,
            String code,
            String displayName,
            String capabilityType,
            String description,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder
    ) {
    }
}
