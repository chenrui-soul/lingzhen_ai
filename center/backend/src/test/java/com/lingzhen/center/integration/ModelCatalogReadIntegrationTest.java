package com.lingzhen.center.integration;

import com.lingzhen.center.model.dto.auth.DeviceRequest;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.ModelCatalogRepository;
import com.lingzhen.center.repository.TenantModelRepository;
import com.lingzhen.center.service.AuthService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Transactional
class ModelCatalogReadIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final Instant PUBLISHED_AT = Instant.parse("2026-08-25T05:00:00Z");
    private static final String PASSWORD = "ValidPassword!123";

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuthService authService;

    @Autowired
    private ModelCatalogRepository modelCatalogRepository;

    @Autowired
    private TenantModelRepository tenantModelRepository;

    private MockMvc mockMvc;
    private JsonNode groundTruth;

    @BeforeEach
    void setUp() throws Exception {
        mockMvc = MockMvcBuilders.webAppContextSetup(applicationContext)
                .apply(springSecurity())
                .build();
        groundTruth = objectMapper.readTree(Files.readString(
                Path.of("references", "model_catalog_read_ground_truth.json"),
                StandardCharsets.UTF_8
        ));
    }

    @Test
    void repositoriesReadDraftCatalogPublishedSnapshotAndEscapedKeyword() {
        AuthService.AuthenticatedSession publisher = register("repository-publisher", ClientType.MANAGEMENT_WEB);
        CatalogSeed seed = publishCatalog(publisher);

        ModelCatalogRepository.ProviderPage providers = modelCatalogRepository.findProviders(0, 20);
        ModelCatalogRepository.ModelPage models = modelCatalogRepository.findModels(
                "seedance_",
                "active",
                "video",
                seed.providerId(),
                0,
                20
        );
        ModelCatalogRepository.VersionPage versions = modelCatalogRepository.findVersions(0, 20);
        ModelCatalogRepository.VersionDetail detail = modelCatalogRepository
                .findVersion(seed.versionId())
                .orElseThrow();

        assertThat(providers.items()).extracting(ModelCatalogRepository.ProviderRow::id)
                .contains(seed.providerId());
        assertThat(models.items()).singleElement().satisfies(model -> {
            assertThat(model.id()).isEqualTo(seed.modelIds().getFirst());
            assertThat(model.code()).isEqualTo("seedance_mini_v1");
            assertThat(model.defaultParameters()).containsEntry("duration", 10);
        });
        assertThat(versions.items()).singleElement().satisfies(version -> {
            assertThat(version.id()).isEqualTo(seed.versionId());
            assertThat(version.current()).isTrue();
            assertThat(version.modelCount()).isEqualTo(2);
        });
        assertThat(detail.models()).hasSize(2);
        assertThat(detail.models()).extracting(ModelCatalogRepository.VersionModelRow::modelId)
                .containsExactlyElementsOf(seed.modelIds());
    }

    @Test
    void tenantPoliciesAreIsolatedAndEffectiveFilterMatchesGroundTruth() {
        AuthService.AuthenticatedSession tenantA = register("tenant-a", ClientType.MANAGEMENT_WEB);
        AuthService.AuthenticatedSession tenantB = register("tenant-b", ClientType.MANAGEMENT_WEB);
        CatalogSeed seed = publishCatalog(tenantA);
        setPolicy(tenantA, seed.modelIds().get(0), "enabled");
        setPolicy(tenantA, seed.modelIds().get(1), "hidden");

        TenantModelRepository.TenantCatalog allTenantA = tenantModelRepository
                .findCurrentCatalog(tenantA.access().tenantId(), false)
                .orElseThrow();
        TenantModelRepository.TenantCatalog effectiveTenantA = tenantModelRepository
                .findCurrentCatalog(tenantA.access().tenantId(), true)
                .orElseThrow();
        TenantModelRepository.TenantCatalog effectiveTenantB = tenantModelRepository
                .findCurrentCatalog(tenantB.access().tenantId(), true)
                .orElseThrow();

        assertThat(allTenantA.models()).extracting(TenantModelRepository.ModelRow::policy)
                .containsExactly("enabled", "hidden");
        assertThat(effectiveTenantA.models()).extracting(TenantModelRepository.ModelRow::modelId)
                .containsExactly(seed.modelIds().get(0));
        assertThat(effectiveTenantB.models()).extracting(TenantModelRepository.ModelRow::modelId)
                .containsExactly(seed.modelIds().get(1));
        assertThat(effectiveTenantB.models()).singleElement().satisfies(model -> {
            assertThat(model.policyId()).isNull();
            assertThat(model.policy()).isEqualTo("inherit");
        });
    }

    @Test
    void repositoriesReturnNoCatalogWhenNothingIsCurrent() {
        AuthService.AuthenticatedSession tenant = register("no-current", ClientType.DESKTOP);

        assertThat(tenantModelRepository.findCurrentCatalog(tenant.access().tenantId(), false))
                .isEmpty();
        assertThat(tenantModelRepository.findCurrentCatalog(tenant.access().tenantId(), true))
                .isEmpty();
    }

    @Test
    void managementCatalogApiRequiresPlatformPermissionAndTerminalBoundary() throws Exception {
        AuthService.AuthenticatedSession platformAdmin = register(
                "platform-admin",
                ClientType.MANAGEMENT_WEB
        );
        AuthService.AuthenticatedSession tenantOwner = register(
                "tenant-owner",
                ClientType.MANAGEMENT_WEB
        );
        AuthService.AuthenticatedSession desktopUser = register(
                "desktop-boundary",
                ClientType.DESKTOP
        );
        CatalogSeed seed = publishCatalog(platformAdmin);
        grantPlatformAdmin(platformAdmin.access().userId());

        mockMvc.perform(get("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(platformAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].code").value("lingzhen-test"));
        mockMvc.perform(get("/api/v1/management/model-catalog/models")
                        .param("capabilityType", "video")
                        .header("Authorization", bearer(platformAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));
        mockMvc.perform(get("/api/v1/management/model-catalog/versions/{versionId}", seed.versionId())
                        .header("Authorization", bearer(platformAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.models.length()").value(2));
        mockMvc.perform(get("/api/v1/management/model-catalog/versions")
                        .header("Authorization", bearer(platformAdmin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1));
        mockMvc.perform(get("/api/v1/management/tenant-models")
                        .header("Authorization", bearer(tenantOwner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true))
                .andExpect(jsonPath("$.models.length()").value(2));

        mockMvc.perform(get("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(tenantOwner)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));
        mockMvc.perform(get("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(desktopUser)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));
        mockMvc.perform(get("/api/v1/desktop/models")
                        .header("Authorization", bearer(platformAdmin)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));
    }

    @Test
    void openApiIncludesNodeThreePointFivePublicationEndpoints() throws Exception {
        JsonNode document = responseJson(mockMvc.perform(get("/v3/api-docs"))
                .andExpect(status().isOk())
                .andReturn());

        JsonNode providerOperations = document.path("paths")
                .path("/api/v1/management/model-catalog/providers");
        assertThat(providerOperations.path("get").isObject()).isTrue();
        assertThat(providerOperations.path("post").isObject()).isTrue();
        assertThat(document.path("paths")
                .path("/api/v1/management/model-catalog/providers/{providerId}")
                .path("put").isObject()).isTrue();

        JsonNode modelOperations = document.path("paths")
                .path("/api/v1/management/model-catalog/models");
        assertThat(modelOperations.path("get").isObject()).isTrue();
        assertThat(modelOperations.path("post").isObject()).isTrue();
        assertThat(document.path("paths")
                .path("/api/v1/management/model-catalog/models/{modelId}")
                .path("put").isObject()).isTrue();

        List<String> remainingReadOnlyPaths = List.of(
                "/api/v1/management/model-catalog/versions",
                "/api/v1/management/model-catalog/versions/{versionId}",
                "/api/v1/desktop/models"
        );
        for (String path : remainingReadOnlyPaths) {
            JsonNode operations = document.path("paths").path(path);
            assertThat(operations.path("get").isObject()).isTrue();
            assertThat(operations.has("post")).isFalse();
            assertThat(operations.has("put")).isFalse();
            assertThat(operations.has("patch")).isFalse();
            assertThat(operations.has("delete")).isFalse();
        }

        JsonNode tenantModelCollection = document.path("paths")
                .path("/api/v1/management/tenant-models");
        assertThat(tenantModelCollection.path("get").isObject()).isTrue();
        assertThat(tenantModelCollection.has("post")).isFalse();
        assertThat(tenantModelCollection.has("put")).isFalse();
        assertThat(tenantModelCollection.has("patch")).isFalse();
        assertThat(tenantModelCollection.has("delete")).isFalse();

        JsonNode tenantModelItem = document.path("paths")
                .path("/api/v1/management/tenant-models/{modelId}");
        assertThat(tenantModelItem.path("put").isObject()).isTrue();
        assertThat(tenantModelItem.has("get")).isFalse();
        assertThat(tenantModelItem.has("post")).isFalse();
        assertThat(tenantModelItem.has("patch")).isFalse();
        assertThat(tenantModelItem.has("delete")).isFalse();

        JsonNode previewOperations = document.path("paths")
                .path("/api/v1/management/model-catalog/publish-preview");
        assertThat(previewOperations.path("get").isObject()).isTrue();
        assertThat(previewOperations.has("post")).isFalse();

        JsonNode publishOperations = document.path("paths")
                .path("/api/v1/management/model-catalog/versions/publish");
        assertThat(publishOperations.path("post").isObject()).isTrue();
        assertThat(publishOperations.has("get")).isFalse();
    }

    @Test
    void desktopModelsAndBootstrapStayConsistentWithoutSensitiveFields() throws Exception {
        AuthService.AuthenticatedSession tenantA = register("desktop-a", ClientType.DESKTOP);
        AuthService.AuthenticatedSession tenantB = register("desktop-b", ClientType.DESKTOP);
        CatalogSeed seed = publishCatalog(tenantA);
        setPolicy(tenantA, seed.modelIds().get(0), "enabled");
        setPolicy(tenantA, seed.modelIds().get(1), "hidden");

        JsonNode tenantAModels = responseJson(mockMvc.perform(get("/api/v1/desktop/models")
                        .header("Authorization", bearer(tenantA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.modelCatalog.available").value(true))
                .andExpect(jsonPath("$.modelCatalog.version").value(1))
                .andExpect(jsonPath("$.models.length()").value(1))
                .andExpect(jsonPath("$.models[0].id").value(seed.modelIds().get(0).toString()))
                .andExpect(jsonPath("$.models[0].source").value("platform"))
                .andExpect(jsonPath("$.models[0].executionReady").value(false))
                .andReturn());
        JsonNode tenantABootstrap = responseJson(mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", bearer(tenantA)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value(1))
                .andExpect(jsonPath("$.models.length()").value(1))
                .andReturn());
        JsonNode tenantBModels = responseJson(mockMvc.perform(get("/api/v1/desktop/models")
                        .header("Authorization", bearer(tenantB)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.models.length()").value(1))
                .andExpect(jsonPath("$.models[0].id").value(seed.modelIds().get(1).toString()))
                .andReturn());

        assertThat(tenantABootstrap.path("modelCatalog"))
                .isEqualTo(tenantAModels.path("modelCatalog"));
        assertThat(tenantABootstrap.path("models"))
                .isEqualTo(tenantAModels.path("models"));
        assertThat(tenantBModels.path("models").get(0).path("id").asText())
                .isNotEqualTo(tenantAModels.path("models").get(0).path("id").asText());

        String desktopPayload = tenantAModels.toString() + tenantABootstrap;
        groundTruth.path("forbiddenResponseFields").forEach(field ->
                assertThat(desktopPayload).doesNotContain("\"" + field.asText() + "\"")
        );
    }

    private AuthService.AuthenticatedSession register(String prefix, ClientType clientType) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String username = prefix + "_" + suffix;
        return authService.register(
                new RegisterRequest(
                        username,
                        prefix + "." + suffix + "@example.com",
                        PASSWORD,
                        null,
                        clientType,
                        new DeviceRequest(
                                sha256(username),
                                1,
                                "Model Catalog Integration Test",
                                "windows",
                                "x64",
                                "test"
                        )
                ),
                new AuthService.RequestMetadata("model-catalog-integration-test")
        );
    }

    private CatalogSeed publishCatalog(AuthService.AuthenticatedSession publisher) {
        JsonNode provider = groundTruth.path("provider");
        UUID providerId = UUID.randomUUID();
        jdbcTemplate.update("""
                        INSERT INTO model_catalog.providers (
                            id, provider_code, display_name, protocol_family,
                            description, status
                        ) VALUES (?, ?, ?, ?, ?, 'active')
                        """,
                providerId,
                provider.path("code").asText(),
                provider.path("displayName").asText(),
                provider.path("protocolFamily").asText(),
                "integration test provider"
        );

        List<UUID> modelIds = new ArrayList<>();
        for (JsonNode model : groundTruth.path("models")) {
            UUID modelId = UUID.randomUUID();
            modelIds.add(modelId);
            jdbcTemplate.update("""
                            INSERT INTO model_catalog.models (
                                id, provider_id, model_code, display_name,
                                capability_type, description, parameter_schema,
                                default_parameters, default_tenant_enabled,
                                sort_order, status
                            ) VALUES (?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?, 'active')
                            """,
                    modelId,
                    providerId,
                    model.path("code").asText(),
                    model.path("displayName").asText(),
                    model.path("capabilityType").asText(),
                    "integration test model",
                    model.path("parameterSchema").toString(),
                    model.path("defaultParameters").toString(),
                    model.path("defaultTenantEnabled").asBoolean(),
                    model.path("sortOrder").asInt()
            );
        }

        UUID versionId = UUID.randomUUID();
        jdbcTemplate.update("""
                        INSERT INTO model_catalog.catalog_versions (
                            id, version_no, content_hash, idempotency_key,
                            published_by_user_id, published_by_membership_id
                        ) VALUES (?, 1, ?, ?, ?, ?)
                        """,
                versionId,
                "a".repeat(64),
                "integration-" + versionId,
                publisher.access().userId(),
                publisher.access().membershipId()
        );

        for (int index = 0; index < modelIds.size(); index++) {
            JsonNode model = groundTruth.path("models").get(index);
            jdbcTemplate.update("""
                            INSERT INTO model_catalog.catalog_version_items (
                                id, catalog_version_id, model_id, provider_id,
                                provider_code, provider_display_name,
                                provider_protocol_family, model_code, display_name,
                                capability_type, description, parameter_schema,
                                default_parameters, default_tenant_enabled, sort_order
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?::jsonb, ?::jsonb, ?, ?)
                            """,
                    UUID.randomUUID(),
                    versionId,
                    modelIds.get(index),
                    providerId,
                    provider.path("code").asText(),
                    provider.path("displayName").asText(),
                    provider.path("protocolFamily").asText(),
                    model.path("code").asText(),
                    model.path("displayName").asText(),
                    model.path("capabilityType").asText(),
                    "integration snapshot",
                    model.path("parameterSchema").toString(),
                    model.path("defaultParameters").toString(),
                    model.path("defaultTenantEnabled").asBoolean(),
                    model.path("sortOrder").asInt()
            );
        }
        jdbcTemplate.update("""
                        UPDATE model_catalog.catalog_versions
                        SET published_at = ?, is_current = true
                        WHERE id = ?
                        """,
                java.sql.Timestamp.from(PUBLISHED_AT),
                versionId
        );
        return new CatalogSeed(providerId, List.copyOf(modelIds), versionId);
    }

    private void setPolicy(
            AuthService.AuthenticatedSession tenant,
            UUID modelId,
            String policy
    ) {
        jdbcTemplate.update("""
                        INSERT INTO model_catalog.tenant_models (
                            id, tenant_id, model_id, policy, updated_by_membership_id
                        ) VALUES (?, ?, ?, ?, ?)
                        """,
                UUID.randomUUID(),
                tenant.access().tenantId(),
                modelId,
                policy,
                tenant.access().membershipId()
        );
    }

    private void grantPlatformAdmin(UUID userId) {
        UUID roleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'platform_admin'",
                UUID.class
        );
        jdbcTemplate.update("""
                        INSERT INTO identity.platform_role_assignments (
                            id, user_id, role_id, status
                        ) VALUES (?, ?, ?, 'active')
                        """,
                UUID.randomUUID(),
                userId,
                roleId
        );
    }

    private String bearer(AuthService.AuthenticatedSession session) {
        return "Bearer " + session.accessToken();
    }

    private JsonNode responseJson(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private String sha256(String value) {
        try {
            return HexFormat.of().formatHex(
                    MessageDigest.getInstance("SHA-256")
                            .digest(value.getBytes(StandardCharsets.UTF_8))
            );
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private record CatalogSeed(UUID providerId, List<UUID> modelIds, UUID versionId) {
    }
}
