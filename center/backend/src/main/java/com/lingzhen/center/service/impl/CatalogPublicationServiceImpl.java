package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishPreviewResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishResponse;
import com.lingzhen.center.model.dto.modelcatalog.PublishCatalogRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ModelCatalogRepository;
import com.lingzhen.center.service.CatalogPublicationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Clock;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class CatalogPublicationServiceImpl implements CatalogPublicationService {

    private static final Logger LOGGER = LoggerFactory.getLogger(CatalogPublicationServiceImpl.class);
    private static final String PUBLISH_PERMISSION = "model_catalog.publish";
    private static final int MAX_PUBLISHED_MODELS = 500;

    private final ModelCatalogRepository repository;
    private final ObjectMapper objectMapper;
    private final Clock clock;

    public CatalogPublicationServiceImpl(
            ModelCatalogRepository repository,
            ObjectMapper objectMapper,
            Clock clock
    ) {
        this.repository = repository;
        this.objectMapper = objectMapper;
        this.clock = clock;
    }

    @Override
    @Transactional(readOnly = true)
    public CatalogPublishPreviewResponse preview(SessionContext sessionContext) {
        requirePermission(sessionContext);
        ModelCatalogRepository.VersionDetail current = repository.findCurrentVersion().orElse(null);
        List<ModelCatalogRepository.VersionModelRow> draft = repository.findPublishableModels();
        return buildPreview(current, draft, repository.nextVersionNumber());
    }

    @Override
    @Transactional
    public CatalogPublishResponse publish(
            SessionContext sessionContext,
            String idempotencyKey,
            PublishCatalogRequest request
    ) {
        requirePermission(sessionContext);
        String normalizedKey = idempotencyKey(idempotencyKey);
        if (request == null || request.expectedContentHash() == null) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "MODEL_CATALOG_PUBLISH_REQUEST_INVALID",
                    "发布请求缺少预览校验信息"
            );
        }

        repository.acquirePublicationLock();
        ModelCatalogRepository.VersionDetail replay = repository
                .findVersionByIdempotencyKey(normalizedKey)
                .orElse(null);
        if (replay != null) {
            if (!replay.version().contentHash().equals(request.expectedContentHash())) {
                throw new ApiException(
                        HttpStatus.CONFLICT,
                        "MODEL_CATALOG_IDEMPOTENCY_KEY_REUSED",
                        "该幂等键已用于其他目录内容，请重新发起发布"
                );
            }
            LOGGER.info(
                    "Model catalog publication replayed: version={}, publisherMembership={}",
                    replay.version().version(),
                    sessionContext.membershipId()
            );
            return response(replay, true);
        }

        ModelCatalogRepository.VersionDetail current = repository.findCurrentVersion().orElse(null);
        Long currentVersion = current == null ? null : current.version().version();
        if (!Objects.equals(currentVersion, request.expectedCurrentVersion())) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_CATALOG_CURRENT_VERSION_CONFLICT",
                    "目录已被其他管理员发布，请刷新预览后重试"
            );
        }

        List<ModelCatalogRepository.VersionModelRow> draft = repository.findPublishableModels();
        CatalogPublishPreviewResponse preview = buildPreview(
                current,
                draft,
                repository.nextVersionNumber()
        );
        if (!preview.blockers().isEmpty()) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_CATALOG_PUBLISH_BLOCKED",
                    preview.blockers().getFirst().message()
            );
        }
        if (!preview.contentHash().equals(request.expectedContentHash())) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_CATALOG_PREVIEW_STALE",
                    "目录草稿已发生变化，请重新预览后发布"
            );
        }
        if (!preview.hasChanges()) {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "MODEL_CATALOG_NO_CHANGES",
                    "当前目录与已发布版本一致，无需重复发布"
            );
        }

        UUID versionId = UUID.randomUUID();
        Instant publishedAt = clock.instant();
        try {
            repository.createVersionHeader(new ModelCatalogRepository.VersionCreateCommand(
                    versionId,
                    preview.nextVersion(),
                    preview.contentHash(),
                    normalizedKey,
                    sessionContext.userId(),
                    sessionContext.membershipId()
            ));
            repository.insertVersionItems(versionId, draft);
            repository.sealVersion(versionId, publishedAt);
            repository.replaceCurrentVersion(versionId);
        } catch (DataIntegrityViolationException exception) {
            throw publicationConflict(exception);
        }

        ModelCatalogRepository.VersionDetail published = repository.findVersion(versionId)
                .orElseThrow(() -> new IllegalStateException(
                        "Published catalog version could not be reloaded"
                ));
        LOGGER.info(
                "Model catalog published: version={}, models={}, publisherMembership={}",
                published.version().version(),
                published.models().size(),
                sessionContext.membershipId()
        );
        return response(published, false);
    }

    private CatalogPublishPreviewResponse buildPreview(
            ModelCatalogRepository.VersionDetail current,
            List<ModelCatalogRepository.VersionModelRow> draft,
            long nextVersion
    ) {
        List<ModelCatalogRepository.VersionModelRow> currentModels = current == null
                ? List.of()
                : current.models();
        Map<UUID, ModelCatalogRepository.VersionModelRow> currentById = byModelId(currentModels);
        Map<UUID, ModelCatalogRepository.VersionModelRow> draftById = byModelId(draft);

        int added = 0;
        int modified = 0;
        for (Map.Entry<UUID, ModelCatalogRepository.VersionModelRow> entry : draftById.entrySet()) {
            ModelCatalogRepository.VersionModelRow previous = currentById.get(entry.getKey());
            if (previous == null) {
                added++;
            } else if (!previous.equals(entry.getValue())) {
                modified++;
            }
        }
        int removed = (int) currentById.keySet().stream()
                .filter(modelId -> !draftById.containsKey(modelId))
                .count();
        boolean hasChanges = added > 0 || modified > 0 || removed > 0;
        List<CatalogPublishPreviewResponse.Blocker> blockers = blockers(draft.size());
        return new CatalogPublishPreviewResponse(
                current == null ? null : current.version().version(),
                current == null ? null : current.version().publishedAt(),
                nextVersion,
                draft.size(),
                added,
                modified,
                removed,
                hasChanges,
                hasChanges && blockers.isEmpty(),
                contentHash(draft),
                blockers
        );
    }

    private Map<UUID, ModelCatalogRepository.VersionModelRow> byModelId(
            List<ModelCatalogRepository.VersionModelRow> models
    ) {
        return models.stream().collect(Collectors.toMap(
                ModelCatalogRepository.VersionModelRow::modelId,
                Function.identity(),
                (first, ignored) -> first,
                LinkedHashMap::new
        ));
    }

    private List<CatalogPublishPreviewResponse.Blocker> blockers(int modelCount) {
        List<CatalogPublishPreviewResponse.Blocker> blockers = new ArrayList<>();
        if (modelCount == 0) {
            blockers.add(new CatalogPublishPreviewResponse.Blocker(
                    "MODEL_CATALOG_EMPTY",
                    "至少启用一个模型后才能发布目录"
            ));
        }
        if (modelCount > MAX_PUBLISHED_MODELS) {
            blockers.add(new CatalogPublishPreviewResponse.Blocker(
                    "MODEL_CATALOG_LIMIT_EXCEEDED",
                    "发布目录最多包含 500 个模型"
            ));
        }
        return List.copyOf(blockers);
    }

    private String contentHash(List<ModelCatalogRepository.VersionModelRow> models) {
        List<HashSnapshotItem> canonical = models.stream()
                .map(item -> new HashSnapshotItem(
                        item.modelId(),
                        item.providerId(),
                        item.providerCode(),
                        item.providerDisplayName(),
                        item.providerProtocolFamily(),
                        item.code(),
                        item.displayName(),
                        item.capabilityType(),
                        item.description(),
                        canonicalValue(item.parameterSchema()),
                        canonicalValue(item.defaultParameters()),
                        item.defaultTenantEnabled(),
                        item.sortOrder()
                ))
                .toList();
        try {
            byte[] json = objectMapper.writeValueAsString(canonical)
                    .getBytes(StandardCharsets.UTF_8);
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(json));
        } catch (JacksonException exception) {
            throw new IllegalStateException("Catalog snapshot could not be serialized", exception);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private Object canonicalValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> sorted = new TreeMap<>();
            map.forEach((key, item) -> sorted.put(String.valueOf(key), canonicalValue(item)));
            return sorted;
        }
        if (value instanceof List<?> list) {
            return list.stream().map(this::canonicalValue).toList();
        }
        return value;
    }

    private CatalogPublishResponse response(
            ModelCatalogRepository.VersionDetail detail,
            boolean idempotentReplay
    ) {
        return new CatalogPublishResponse(
                detail.version().id(),
                detail.version().version(),
                detail.version().current(),
                detail.models().size(),
                detail.version().publishedAt(),
                idempotentReplay
        );
    }

    private void requirePermission(SessionContext context) {
        if (context == null
                || context.clientType() != ClientType.MANAGEMENT_WEB
                || !context.permissions().contains(PUBLISH_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "MODEL_CATALOG_PUBLISH_FORBIDDEN",
                    "当前账号没有发布平台模型目录的权限"
            );
        }
    }

    private String idempotencyKey(String value) {
        if (value == null || value.isBlank()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "IDEMPOTENCY_KEY_REQUIRED",
                    "发布目录必须提供 Idempotency-Key"
            );
        }
        String normalized = value.trim();
        if (normalized.length() < 8
                || normalized.length() > 128
                || !normalized.matches("[A-Za-z0-9._:-]+")) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_IDEMPOTENCY_KEY",
                    "Idempotency-Key 格式不正确"
            );
        }
        return normalized;
    }

    private ApiException publicationConflict(DataIntegrityViolationException exception) {
        LOGGER.warn("Model catalog publication conflicted with another transaction", exception);
        return new ApiException(
                HttpStatus.CONFLICT,
                "MODEL_CATALOG_PUBLISH_CONFLICT",
                "目录发布发生并发冲突，请刷新预览后重试"
        );
    }

    private record HashSnapshotItem(
            UUID modelId,
            UUID providerId,
            String providerCode,
            String providerDisplayName,
            String providerProtocolFamily,
            String modelCode,
            String displayName,
            String capabilityType,
            String description,
            Object parameterSchema,
            Object defaultParameters,
            boolean defaultTenantEnabled,
            int sortOrder
    ) {
    }
}
