package com.lingzhen.center.integration;

import com.lingzhen.center.model.dto.auth.DeviceRequest;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.AuthService;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
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
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Transactional
class ModelCatalogWriteIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final String PASSWORD = "ValidPassword!123";
    private static final String CSRF_TOKEN = "wave34-csrf-token";

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuthService authService;

    private MockMvc mockMvc;
    private JsonNode groundTruth;

    @BeforeEach
    void setUp() throws Exception {
        mockMvc = MockMvcBuilders.webAppContextSetup(applicationContext)
                .apply(springSecurity())
                .build();
        groundTruth = objectMapper.readTree(Files.readString(
                Path.of("references", "model_catalog_write_ground_truth.json"),
                StandardCharsets.UTF_8
        ));
    }

    @Test
    void createsUpdatesAndActivatesProviderAndModelWithOptimisticLock() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("write-happy");
        JsonNode provider = createProvider(admin);
        UUID providerId = UUID.fromString(provider.path("id").asText());

        JsonNode activeProvider = responseJson(mockMvc.perform(put(
                                "/api/v1/management/model-catalog/providers/{providerId}",
                                providerId
                        )
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(providerUpdate("active", 0))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.rowVersion").value(1))
                .andReturn());

        JsonNode modelDefinition = groundTruth.path("model");
        Map<String, Object> createModel = new LinkedHashMap<>();
        createModel.put("providerId", providerId);
        createModel.put("code", modelDefinition.path("code").asText());
        createModel.put("displayName", modelDefinition.path("displayName").asText());
        createModel.put("capabilityType", modelDefinition.path("capabilityType").asText());
        createModel.put("description", modelDefinition.path("description").asText());
        createModel.put("parameterSchema", objectMapper.convertValue(
                modelDefinition.path("parameterSchema"), Map.class
        ));
        createModel.put("defaultParameters", objectMapper.convertValue(
                modelDefinition.path("defaultParameters"), Map.class
        ));
        createModel.put("defaultTenantEnabled", false);
        createModel.put("sortOrder", modelDefinition.path("sortOrder").asInt());

        JsonNode model = responseJson(mockMvc.perform(post(
                                "/api/v1/management/model-catalog/models"
                        )
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(createModel)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("draft"))
                .andExpect(jsonPath("$.rowVersion").value(0))
                .andExpect(jsonPath("$.defaultTenantEnabled").value(false))
                .andReturn());
        UUID modelId = UUID.fromString(model.path("id").asText());

        Map<String, Object> updateModel = new LinkedHashMap<>(createModel);
        updateModel.put("status", "active");
        updateModel.put("rowVersion", 0);
        mockMvc.perform(put("/api/v1/management/model-catalog/models/{modelId}", modelId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(updateModel)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.rowVersion").value(1));

        mockMvc.perform(put("/api/v1/management/model-catalog/models/{modelId}", modelId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(updateModel)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_ROW_VERSION_CONFLICT"));

        assertThat(activeProvider.path("id").asText()).isEqualTo(providerId.toString());
    }

    @Test
    void rejectsMissingCsrfMissingPermissionAndTenantIdInjection() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("write-security");
        AuthService.AuthenticatedSession tenantOwner = register(
                "write-owner",
                ClientType.MANAGEMENT_WEB
        );
        Map<String, Object> provider = providerCreate();

        mockMvc.perform(post("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(provider)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_VALIDATION_FAILED"));

        mockMvc.perform(post("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(tenantOwner))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(provider)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        provider.put("tenantId", UUID.randomUUID());
        mockMvc.perform(post("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(provider)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST_BODY"));
    }

    @Test
    void enforcesDuplicateCodesProviderStateAndActiveModelDeactivationRule() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("write-state");
        JsonNode provider = createProvider(admin);
        UUID providerId = UUID.fromString(provider.path("id").asText());

        mockMvc.perform(post("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(providerCreate())))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_PROVIDER_CODE_CONFLICT"));

        Map<String, Object> createModel = modelCreate(providerId, Map.of("type", "object"));
        JsonNode model = responseJson(mockMvc.perform(post(
                                "/api/v1/management/model-catalog/models"
                        )
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(createModel)))
                .andExpect(status().isCreated())
                .andReturn());
        UUID modelId = UUID.fromString(model.path("id").asText());

        mockMvc.perform(post("/api/v1/management/model-catalog/models")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(createModel)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_CODE_CONFLICT"));

        Map<String, Object> activateModel = modelUpdate(createModel, "active", 0);
        mockMvc.perform(put("/api/v1/management/model-catalog/models/{modelId}", modelId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(activateModel)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_PROVIDER_NOT_ACTIVE"));

        mockMvc.perform(put("/api/v1/management/model-catalog/providers/{providerId}", providerId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(providerUpdate("active", 0))))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/v1/management/model-catalog/models/{modelId}", modelId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(activateModel)))
                .andExpect(status().isOk());

        mockMvc.perform(put("/api/v1/management/model-catalog/providers/{providerId}", providerId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(providerUpdate("inactive", 1))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_PROVIDER_HAS_ACTIVE_MODELS"));
    }

    @Test
    void rejectsSensitiveModelContracts() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("write-schema");
        JsonNode provider = createProvider(admin);
        UUID providerId = UUID.fromString(provider.path("id").asText());
        Map<String, Object> request = modelCreate(
                providerId,
                Map.of("type", "object", "properties", Map.of("apiKey", Map.of()))
        );

        mockMvc.perform(post("/api/v1/management/model-catalog/models")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(request)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MODEL_SCHEMA_INVALID"));
    }

    @Test
    void mapsDuplicateModelCodeDuringUpdateToContractConflict() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("write-update-conflict");
        JsonNode provider = createProvider(admin);
        UUID providerId = UUID.fromString(provider.path("id").asText());
        Map<String, Object> firstRequest = modelCreate(providerId, Map.of("type", "object"));
        mockMvc.perform(post("/api/v1/management/model-catalog/models")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(firstRequest)))
                .andExpect(status().isCreated());

        Map<String, Object> secondRequest = new LinkedHashMap<>(firstRequest);
        secondRequest.put("code", "wave34-video-v2");
        JsonNode secondModel = responseJson(mockMvc.perform(post(
                                "/api/v1/management/model-catalog/models"
                        )
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(secondRequest)))
                .andExpect(status().isCreated())
                .andReturn());
        UUID secondModelId = UUID.fromString(secondModel.path("id").asText());

        Map<String, Object> conflictingUpdate = modelUpdate(firstRequest, "draft", 0);
        mockMvc.perform(put(
                                "/api/v1/management/model-catalog/models/{modelId}",
                                secondModelId
                        )
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(conflictingUpdate)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_CODE_CONFLICT"));
    }

    private JsonNode createProvider(AuthService.AuthenticatedSession admin) throws Exception {
        return responseJson(mockMvc.perform(post("/api/v1/management/model-catalog/providers")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(providerCreate())))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("draft"))
                .andExpect(jsonPath("$.rowVersion").value(0))
                .andReturn());
    }

    private Map<String, Object> providerCreate() {
        JsonNode provider = groundTruth.path("provider");
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("code", provider.path("code").asText());
        request.put("displayName", provider.path("displayName").asText());
        request.put("protocolFamily", provider.path("protocolFamily").asText());
        request.put("description", provider.path("description").asText());
        return request;
    }

    private Map<String, Object> providerUpdate(String status, long rowVersion) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("displayName", "Wave 3.4 Provider Updated");
        request.put("protocolFamily", "openai_compatible");
        request.put("description", "updated provider");
        request.put("status", status);
        request.put("rowVersion", rowVersion);
        return request;
    }

    private Map<String, Object> modelCreate(UUID providerId, Map<String, Object> schema) {
        JsonNode model = groundTruth.path("model");
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("providerId", providerId);
        request.put("code", model.path("code").asText());
        request.put("displayName", model.path("displayName").asText());
        request.put("capabilityType", model.path("capabilityType").asText());
        request.put("description", model.path("description").asText());
        request.put("parameterSchema", schema);
        request.put("defaultParameters", Map.of("duration", 10));
        request.put("defaultTenantEnabled", false);
        request.put("sortOrder", model.path("sortOrder").asInt());
        return request;
    }

    private Map<String, Object> modelUpdate(
            Map<String, Object> createRequest,
            String status,
            long rowVersion
    ) {
        Map<String, Object> request = new LinkedHashMap<>(createRequest);
        request.put("status", status);
        request.put("rowVersion", rowVersion);
        return request;
    }

    private AuthService.AuthenticatedSession platformAdmin(String prefix) {
        AuthService.AuthenticatedSession session = register(prefix, ClientType.MANAGEMENT_WEB);
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
                session.access().userId(),
                roleId
        );
        return session;
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
                                "Model Catalog Write Integration Test",
                                "windows",
                                "x64",
                                "test"
                        )
                ),
                new AuthService.RequestMetadata("model-catalog-write-integration-test")
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
}
