package com.lingzhen.center.integration;

import com.lingzhen.center.model.dto.auth.DeviceRequest;
import com.lingzhen.center.model.dto.auth.LoginRequest;
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
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@Transactional
class TenantModelWriteIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final String PASSWORD = "ValidPassword!123";
    private static final String CSRF_TOKEN = "wave36-csrf-token";
    private static final Instant PUBLISHED_AT = Instant.parse("2026-08-25T06:30:00Z");

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuthService authService;

    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(applicationContext)
                .apply(springSecurity())
                .build();
    }

    @Test
    void writesEnabledHiddenAndInheritAndDesktopReadsTheChangeImmediately() throws Exception {
        RegisteredUser tenant = register("tenant-policy-lifecycle", ClientType.MANAGEMENT_WEB);
        CatalogSeed catalog = publishCatalog(tenant.session());
        AuthService.AuthenticatedSession desktop = loginDesktop(tenant);
        UUID optInModelId = catalog.modelIds().getFirst();

        MvcResult enabledResult = updatePolicy(tenant.session(), optInModelId, "enabled", null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policy").value("enabled"))
                .andExpect(jsonPath("$.effectiveEnabled").value(true))
                .andExpect(jsonPath("$.rowVersion").value(0))
                .andReturn();
        JsonNode enabled = responseJson(enabledResult);

        assertDesktopCatalog(desktop, optInModelId, true);
        mockMvc.perform(get("/api/v1/management/tenant-models")
                        .header("Authorization", bearer(tenant.session())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.models[0].modelId").value(optInModelId.toString()))
                .andExpect(jsonPath("$.models[0].policy").value("enabled"));

        MvcResult hiddenResult = updatePolicy(
                tenant.session(),
                optInModelId,
                "hidden",
                enabled.path("rowVersion").asLong()
        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policy").value("hidden"))
                .andExpect(jsonPath("$.effectiveEnabled").value(false))
                .andExpect(jsonPath("$.rowVersion").value(1))
                .andReturn();
        JsonNode hidden = responseJson(hiddenResult);

        assertDesktopCatalog(desktop, optInModelId, false);

        updatePolicy(
                tenant.session(),
                optInModelId,
                "inherit",
                hidden.path("rowVersion").asLong()
        )
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.policy").value("inherit"))
                .andExpect(jsonPath("$.effectiveEnabled").value(false))
                .andExpect(jsonPath("$.rowVersion").value(2));

        assertDesktopCatalog(desktop, optInModelId, false);
        assertThat(jdbcTemplate.queryForObject("""
                        SELECT policy
                        FROM model_catalog.tenant_models
                        WHERE tenant_id = ? AND model_id = ?
                        """, String.class, tenant.session().access().tenantId(), optInModelId))
                .isEqualTo("inherit");
    }

    @Test
    void isolatesTenantPoliciesAndRejectsStaleVersionsAndUnknownModels() throws Exception {
        RegisteredUser tenantA = register("tenant-policy-a", ClientType.MANAGEMENT_WEB);
        RegisteredUser tenantB = register("tenant-policy-b", ClientType.MANAGEMENT_WEB);
        CatalogSeed catalog = publishCatalog(tenantA.session());
        UUID optInModelId = catalog.modelIds().getFirst();

        updatePolicy(tenantA.session(), optInModelId, "enabled", null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.rowVersion").value(0));

        mockMvc.perform(get("/api/v1/management/tenant-models")
                        .header("Authorization", bearer(tenantB.session())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.models[0].modelId").value(optInModelId.toString()))
                .andExpect(jsonPath("$.models[0].policy").value("inherit"))
                .andExpect(jsonPath("$.models[0].effectiveEnabled").value(false));

        updatePolicy(tenantA.session(), optInModelId, "hidden", 8L)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("TENANT_MODEL_ROW_VERSION_CONFLICT"));

        updatePolicy(tenantA.session(), UUID.randomUUID(), "enabled", null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("TENANT_MODEL_NOT_IN_CURRENT_CATALOG"));

        assertThat(jdbcTemplate.queryForObject("""
                        SELECT count(*)
                        FROM model_catalog.tenant_models
                        WHERE tenant_id = ? AND model_id = ?
                        """, Integer.class, tenantB.session().access().tenantId(), optInModelId))
                .isZero();
    }

    @Test
    void rejectsMissingCsrfDesktopTokensAndTenantIdInjection() throws Exception {
        RegisteredUser tenant = register("tenant-policy-security", ClientType.MANAGEMENT_WEB);
        CatalogSeed catalog = publishCatalog(tenant.session());
        AuthService.AuthenticatedSession desktop = loginDesktop(tenant);
        UUID modelId = catalog.modelIds().getFirst();

        mockMvc.perform(put("/api/v1/management/tenant-models/{modelId}", modelId)
                        .header("Authorization", bearer(tenant.session()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(policyRequest("enabled", null))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_VALIDATION_FAILED"));

        updatePolicy(desktop, modelId, "enabled", null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        Map<String, Object> injected = policyRequest("enabled", null);
        injected.put("tenantId", UUID.randomUUID());
        mockMvc.perform(put("/api/v1/management/tenant-models/{modelId}", modelId)
                        .header("Authorization", bearer(tenant.session()))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(injected)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_REQUEST_BODY"));
    }

    private org.springframework.test.web.servlet.ResultActions updatePolicy(
            AuthService.AuthenticatedSession session,
            UUID modelId,
            String policy,
            Long rowVersion
    ) throws Exception {
        return mockMvc.perform(put("/api/v1/management/tenant-models/{modelId}", modelId)
                .header("Authorization", bearer(session))
                .header("X-CSRF-Token", CSRF_TOKEN)
                .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(objectMapper.writeValueAsBytes(policyRequest(policy, rowVersion))));
    }

    private Map<String, Object> policyRequest(String policy, Long rowVersion) {
        Map<String, Object> request = new LinkedHashMap<>();
        request.put("policy", policy);
        request.put("rowVersion", rowVersion);
        return request;
    }

    private void assertDesktopCatalog(
            AuthService.AuthenticatedSession desktop,
            UUID modelId,
            boolean expected
    ) throws Exception {
        JsonNode models = responseJson(mockMvc.perform(get("/api/v1/desktop/models")
                        .header("Authorization", bearer(desktop)))
                .andExpect(status().isOk())
                .andReturn());
        JsonNode bootstrap = responseJson(mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", bearer(desktop)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value(1))
                .andReturn());

        List<String> modelIds = models.path("models").valueStream()
                .map(model -> model.path("id").asText())
                .toList();
        assertThat(modelIds.contains(modelId.toString())).isEqualTo(expected);
        assertThat(bootstrap.path("modelCatalog")).isEqualTo(models.path("modelCatalog"));
        assertThat(bootstrap.path("models")).isEqualTo(models.path("models"));
    }

    private RegisteredUser register(String prefix, ClientType clientType) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String username = prefix + "_" + suffix;
        AuthService.AuthenticatedSession session = authService.register(
                new RegisterRequest(
                        username,
                        prefix + "." + suffix + "@example.com",
                        PASSWORD,
                        null,
                        clientType,
                        device(username, clientType)
                ),
                new AuthService.RequestMetadata("tenant-model-write-integration-test")
        );
        return new RegisteredUser(username, session);
    }

    private AuthService.AuthenticatedSession loginDesktop(RegisteredUser user) {
        AuthService.LoginOutcome outcome = authService.login(
                new LoginRequest(
                        user.username(),
                        PASSWORD,
                        ClientType.DESKTOP,
                        device(user.username() + "-desktop", ClientType.DESKTOP)
                ),
                new AuthService.RequestMetadata("tenant-model-write-desktop-test")
        );
        return (AuthService.AuthenticatedSession) outcome;
    }

    private DeviceRequest device(String identity, ClientType clientType) {
        return new DeviceRequest(
                sha256(identity + clientType.value()),
                1,
                "Tenant Model Integration Test",
                "windows",
                "x64",
                "test"
        );
    }

    private CatalogSeed publishCatalog(AuthService.AuthenticatedSession publisher) {
        UUID providerId = UUID.randomUUID();
        jdbcTemplate.update("""
                        INSERT INTO model_catalog.providers (
                            id, provider_code, display_name, protocol_family,
                            description, status
                        ) VALUES (?, ?, ?, 'openai_compatible', ?, 'active')
                        """,
                providerId,
                "wave36-" + providerId.toString().substring(0, 8),
                "Wave 3.6 Provider",
                "tenant policy integration provider"
        );

        List<UUID> modelIds = List.of(UUID.randomUUID(), UUID.randomUUID());
        boolean[] defaults = {false, true};
        for (int index = 0; index < modelIds.size(); index++) {
            jdbcTemplate.update("""
                            INSERT INTO model_catalog.models (
                                id, provider_id, model_code, display_name,
                                capability_type, description, parameter_schema,
                                default_parameters, default_tenant_enabled,
                                sort_order, status
                            ) VALUES (?, ?, ?, ?, 'video', ?, '{}'::jsonb,
                                      '{}'::jsonb, ?, ?, 'active')
                            """,
                    modelIds.get(index),
                    providerId,
                    "wave36-video-" + index,
                    "Wave 3.6 Video " + index,
                    "tenant policy integration model",
                    defaults[index],
                    index + 1
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
                "b".repeat(64),
                "wave36-" + versionId,
                publisher.access().userId(),
                publisher.access().membershipId()
        );

        for (int index = 0; index < modelIds.size(); index++) {
            jdbcTemplate.update("""
                            INSERT INTO model_catalog.catalog_version_items (
                                id, catalog_version_id, model_id, provider_id,
                                provider_code, provider_display_name,
                                provider_protocol_family, model_code, display_name,
                                capability_type, description, parameter_schema,
                                default_parameters, default_tenant_enabled, sort_order
                            ) VALUES (?, ?, ?, ?, ?, ?, 'openai_compatible', ?, ?,
                                      'video', ?, '{}'::jsonb, '{}'::jsonb, ?, ?)
                            """,
                    UUID.randomUUID(),
                    versionId,
                    modelIds.get(index),
                    providerId,
                    "wave36-" + providerId.toString().substring(0, 8),
                    "Wave 3.6 Provider",
                    "wave36-video-" + index,
                    "Wave 3.6 Video " + index,
                    "tenant policy integration snapshot",
                    defaults[index],
                    index + 1
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
        return new CatalogSeed(modelIds);
    }

    private String bearer(AuthService.AuthenticatedSession session) {
        return "Bearer " + session.accessToken();
    }

    private JsonNode responseJson(MvcResult result) {
        try {
            return objectMapper.readTree(result.getResponse().getContentAsByteArray());
        } catch (Exception exception) {
            throw new IllegalStateException("Cannot parse test response", exception);
        }
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

    private record RegisteredUser(
            String username,
            AuthService.AuthenticatedSession session
    ) {
    }

    private record CatalogSeed(List<UUID> modelIds) {
    }
}
