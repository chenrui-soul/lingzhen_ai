package com.lingzhen.center.model.dto.desktop;

import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.UUID;

public record DesktopBootstrapResponse(
        int schemaVersion,
        Instant generatedAt,
        UserSummary user,
        TenantSummary tenant,
        MembershipSummary membership,
        Set<String> permissions,
        FeatureSummary features,
        CreditSummary credits,
        ModelCatalogSummary modelCatalog,
        List<PlatformModelSummary> models,
        List<Map<String, Object>> skills,
        List<DoubaoAccountSummary> doubaoAccounts,
        List<RecentProjectSummary> recentProjects
) {

    public static final int SCHEMA_VERSION = 1;

    private static final Set<String> MODEL_CAPABILITIES = Set.of(
            "text",
            "image",
            "video",
            "audio"
    );

    private static final int MAX_PLATFORM_MODELS = 500;
    private static final int MAX_SKILLS = 100;
    private static final int MAX_DOUBAO_ACCOUNTS = 50;
    private static final int MAX_RECENT_PROJECTS = 10;
    private static final int MAX_CONTRACT_DEPTH = 12;
    private static final int MAX_CONTRACT_ARRAY_ITEMS = 1000;
    private static final int MAX_CONTRACT_OBJECT_KEYS = 200;

    private static final Set<String> FORBIDDEN_MODEL_KEYS = Set.of(
            "apikey",
            "authorization",
            "baseurl",
            "constructor",
            "credential",
            "credentialref",
            "customheaders",
            "databaseurl",
            "headers",
            "privateheaders",
            "proto",
            "prototype",
            "secret",
            "token"
    );

    public DesktopBootstrapResponse {
        if (schemaVersion != SCHEMA_VERSION) {
            throw new IllegalArgumentException("Desktop bootstrap schemaVersion must remain 1");
        }
        permissions = Set.copyOf(Objects.requireNonNull(permissions, "permissions"));
        modelCatalog = Objects.requireNonNull(modelCatalog, "modelCatalog");
        models = List.copyOf(Objects.requireNonNull(models, "models"));
        skills = List.copyOf(Objects.requireNonNull(skills, "skills"));
        doubaoAccounts = List.copyOf(Objects.requireNonNull(doubaoAccounts, "doubaoAccounts"));
        recentProjects = List.copyOf(Objects.requireNonNull(recentProjects, "recentProjects"));
        if (models.size() > MAX_PLATFORM_MODELS) {
            throw new IllegalArgumentException("Desktop model catalog exceeds the supported model limit");
        }
        if (skills.size() > MAX_SKILLS || doubaoAccounts.size() > MAX_DOUBAO_ACCOUNTS
                || recentProjects.size() > MAX_RECENT_PROJECTS) {
            throw new IllegalArgumentException("Desktop bootstrap aggregate exceeds the supported item limit");
        }
        if (!models.isEmpty()) {
            if (!modelCatalog.available() || modelCatalog.version() == null) {
                throw new IllegalArgumentException("Platform models require an available catalog version");
            }
            for (PlatformModelSummary model : models) {
                if (model.catalogVersion() != modelCatalog.version()) {
                    throw new IllegalArgumentException("Platform model catalogVersion must match modelCatalog.version");
                }
            }
        }
    }

    public DesktopBootstrapResponse(
            int schemaVersion,
            Instant generatedAt,
            UserSummary user,
            TenantSummary tenant,
            MembershipSummary membership,
            Set<String> permissions,
            FeatureSummary features,
            CreditSummary credits,
            ModelCatalogSummary modelCatalog,
            List<PlatformModelSummary> models,
            List<Map<String, Object>> skills
    ) {
        this(schemaVersion, generatedAt, user, tenant, membership, permissions, features, credits,
                modelCatalog, models, skills, List.of(), List.of());
    }

    public record UserSummary(UUID id, String username, String email) {
    }

    public record TenantSummary(UUID id, String code, String displayName) {
    }

    public record MembershipSummary(UUID id, String role) {
    }

    public record FeatureSummary(boolean infiniteCanvas) {
    }

    public record CreditSummary(boolean available, long balance) {
    }

    public record DoubaoAccountSummary(
            String accountId,
            String displayName,
            String loginState,
            String loginSummary,
            Instant lastCheckedAt,
            Instant updatedAt
    ) {
        public DoubaoAccountSummary {
            requireText(accountId, "doubaoAccount.accountId");
            requireText(displayName, "doubaoAccount.displayName");
            if (!Set.of("unknown", "logged_in", "logged_out", "verification_required").contains(loginState)) {
                throw new IllegalArgumentException("Unsupported Doubao loginState");
            }
        }
    }

    public record RecentProjectSummary(String id, String name, Instant updatedAt) {
        public RecentProjectSummary {
            requireText(id, "recentProject.id");
            requireText(name, "recentProject.name");
        }
    }

    public record ModelCatalogSummary(boolean available, Long version, Instant publishedAt) {

        public ModelCatalogSummary {
            if (available && (version == null || version < 1 || publishedAt == null)) {
                throw new IllegalArgumentException("Available model catalog requires version and publishedAt");
            }
            if (!available && (version != null || publishedAt != null)) {
                throw new IllegalArgumentException("Unavailable model catalog cannot expose version metadata");
            }
        }
    }

    public record PlatformProviderSummary(
            UUID id,
            String code,
            String displayName
    ) {

        public PlatformProviderSummary {
            Objects.requireNonNull(id, "provider.id");
            requireText(code, "provider.code");
            requireText(displayName, "provider.displayName");
        }
    }

    public record PlatformModelSummary(
            UUID id,
            String source,
            PlatformProviderSummary provider,
            String code,
            String displayName,
            String capabilityType,
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters,
            long catalogVersion,
            boolean executionReady
    ) {

        public PlatformModelSummary {
            Objects.requireNonNull(id, "model.id");
            if (!"platform".equals(source)) {
                throw new IllegalArgumentException("Desktop catalog model source must be platform");
            }
            Objects.requireNonNull(provider, "model.provider");
            requireText(code, "model.code");
            requireText(displayName, "model.displayName");
            if (!MODEL_CAPABILITIES.contains(capabilityType)) {
                throw new IllegalArgumentException("Unsupported platform model capabilityType");
            }
            parameterSchema = copyPublicObject(parameterSchema, "parameterSchema");
            defaultParameters = copyPublicObject(defaultParameters, "defaultParameters");
            if (catalogVersion < 1) {
                throw new IllegalArgumentException("Platform model catalogVersion must be positive");
            }
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }

    private static Map<String, Object> copyPublicObject(Map<String, Object> value, String field) {
        Objects.requireNonNull(value, field);
        return Collections.unmodifiableMap(copyPublicMap(value, field, 0));
    }

    private static LinkedHashMap<String, Object> copyPublicMap(Map<?, ?> value, String path, int depth) {
        requireSupportedDepth(depth, path);
        if (value.size() > MAX_CONTRACT_OBJECT_KEYS) {
            throw new IllegalArgumentException("Model contract object is too large: " + path);
        }
        LinkedHashMap<String, Object> copy = new LinkedHashMap<>();
        value.forEach((rawKey, rawValue) -> {
            if (!(rawKey instanceof String key)) {
                throw new IllegalArgumentException("Model contract keys must be strings: " + path);
            }
            if (key.isBlank() || FORBIDDEN_MODEL_KEYS.contains(normalizeKey(key))) {
                throw new IllegalArgumentException("Sensitive or invalid model field is forbidden: " + path + "." + key);
            }
            copy.put(key, copyPublicValue(rawValue, path + "." + key, depth + 1));
        });
        return copy;
    }

    private static Object copyPublicValue(Object value, String path, int depth) {
        requireSupportedDepth(depth, path);
        if (value == null || value instanceof String || value instanceof Boolean) {
            return value;
        }
        if (value instanceof Number number) {
            if (number instanceof Double doubleValue && !Double.isFinite(doubleValue)) {
                throw new IllegalArgumentException("Non-finite model number is forbidden: " + path);
            }
            if (number instanceof Float floatValue && !Float.isFinite(floatValue)) {
                throw new IllegalArgumentException("Non-finite model number is forbidden: " + path);
            }
            return number;
        }
        if (value instanceof Map<?, ?> map) {
            return Collections.unmodifiableMap(copyPublicMap(map, path, depth));
        }
        if (value instanceof List<?> list) {
            if (list.size() > MAX_CONTRACT_ARRAY_ITEMS) {
                throw new IllegalArgumentException("Model contract array is too large: " + path);
            }
            List<Object> copy = new ArrayList<>(list.size());
            for (int index = 0; index < list.size(); index++) {
                copy.add(copyPublicValue(list.get(index), path + "[" + index + "]", depth + 1));
            }
            return Collections.unmodifiableList(copy);
        }
        throw new IllegalArgumentException("Unsupported model contract value: " + path);
    }

    private static void requireSupportedDepth(int depth, String path) {
        if (depth > MAX_CONTRACT_DEPTH) {
            throw new IllegalArgumentException("Model contract is too deeply nested: " + path);
        }
    }

    private static String normalizeKey(String key) {
        return key.replaceAll("[^A-Za-z0-9]", "").toLowerCase(Locale.ROOT);
    }
}
