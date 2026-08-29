package com.lingzhen.center.integration;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.DeviceRequest;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishResponse;
import com.lingzhen.center.model.dto.modelcatalog.PublishCatalogRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.AuthService;
import com.lingzhen.center.service.CatalogPublicationService;
import jakarta.servlet.http.Cookie;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import org.testcontainers.containers.PostgreSQLContainer;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
class ModelCatalogPublicationIntegrationTest {

    private static final String OWNER_PASSWORD = "publication-owner-test-password";
    private static final String APP_PASSWORD = "publication-app-test-password";
    private static final String PASSWORD = "ValidPassword!123";
    private static final String CSRF_TOKEN = "wave35-csrf-token";
    private static final PostgreSQLContainer<?> POSTGRES =
            new PostgreSQLContainer<>("postgres:16-alpine")
                    .withDatabaseName("lingframe_identity")
                    .withUsername("lingframe_owner")
                    .withPassword(OWNER_PASSWORD);

    static {
        POSTGRES.start();
        prepareDatabase();
    }

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuthService authService;

    @Autowired
    private CatalogPublicationService publicationService;

    private MockMvc mockMvc;

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", () -> "lingframe_app");
        registry.add("spring.datasource.password", () -> APP_PASSWORD);
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("app.auth.hmac-secret", () -> Base64.getEncoder().encodeToString(
                "publication-integration-hmac-key-32-bytes"
                        .getBytes(StandardCharsets.UTF_8)
        ));
        registry.add("app.auth.secure-cookies", () -> "false");
    }

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(applicationContext)
                .apply(springSecurity())
                .build();
    }

    @Test
    void publishesIdempotentlyProtectsConcurrencyAndKeepsOldSnapshotsImmutable() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("publication-admin");
        AuthService.AuthenticatedSession owner = register("publication-owner");
        UUID modelId = seedActiveModel();

        JsonNode firstPreview = responseJson(mockMvc.perform(get(
                                "/api/v1/management/model-catalog/publish-preview"
                        )
                        .header("Authorization", bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersion").doesNotExist())
                .andExpect(jsonPath("$.nextVersion").value(1))
                .andExpect(jsonPath("$.addedCount").value(1))
                .andExpect(jsonPath("$.canPublish").value(true))
                .andReturn());
        String firstHash = firstPreview.path("contentHash").asText();
        Map<String, Object> firstPublish = Map.of("expectedContentHash", firstHash);

        mockMvc.perform(post("/api/v1/management/model-catalog/versions/publish")
                        .header("Authorization", bearer(admin))
                        .header("Idempotency-Key", "wave35-first-publish")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(firstPublish)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_VALIDATION_FAILED"));

        mockMvc.perform(post("/api/v1/management/model-catalog/versions/publish")
                        .header("Authorization", bearer(owner))
                        .header("Idempotency-Key", "wave35-owner-publish")
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(firstPublish)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        JsonNode firstPublished = responseJson(mockMvc.perform(post(
                                "/api/v1/management/model-catalog/versions/publish"
                        )
                        .header("Authorization", bearer(admin))
                        .header("Idempotency-Key", "wave35-first-publish")
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(firstPublish)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.version").value(1))
                .andExpect(jsonPath("$.idempotentReplay").value(false))
                .andReturn());

        mockMvc.perform(post("/api/v1/management/model-catalog/versions/publish")
                        .header("Authorization", bearer(admin))
                        .header("Idempotency-Key", "wave35-first-publish")
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(firstPublish)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.versionId").value(firstPublished.path("versionId").asText()))
                .andExpect(jsonPath("$.idempotentReplay").value(true));

        mockMvc.perform(post("/api/v1/management/model-catalog/versions/publish")
                        .header("Authorization", bearer(admin))
                        .header("Idempotency-Key", "wave35-no-change")
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "expectedCurrentVersion", 1,
                                "expectedContentHash", firstHash
                        ))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MODEL_CATALOG_NO_CHANGES"));

        jdbcTemplate.update("""
                        UPDATE model_catalog.models
                        SET display_name = 'Wave Video Updated',
                            updated_at = now(),
                            row_version = row_version + 1
                        WHERE id = ?
                        """,
                modelId
        );
        JsonNode secondPreview = responseJson(mockMvc.perform(get(
                                "/api/v1/management/model-catalog/publish-preview"
                        )
                        .header("Authorization", bearer(admin)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.currentVersion").value(1))
                .andExpect(jsonPath("$.nextVersion").value(2))
                .andExpect(jsonPath("$.modifiedCount").value(1))
                .andExpect(jsonPath("$.canPublish").value(true))
                .andReturn());
        String secondHash = secondPreview.path("contentHash").asText();
        PublishCatalogRequest concurrentRequest = new PublishCatalogRequest(1L, secondHash);
        SessionContext publisher = publishContext(admin.access());

        CountDownLatch ready = new CountDownLatch(2);
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            Future<Attempt> first = executor.submit(() -> attemptPublish(
                    publisher,
                    "wave35-concurrent-a",
                    concurrentRequest,
                    ready,
                    start
            ));
            Future<Attempt> second = executor.submit(() -> attemptPublish(
                    publisher,
                    "wave35-concurrent-b",
                    concurrentRequest,
                    ready,
                    start
            ));
            ready.await();
            start.countDown();
            Attempt firstAttempt = first.get();
            Attempt secondAttempt = second.get();

            assertThat(java.util.List.of(firstAttempt.code(), secondAttempt.code()))
                    .containsExactlyInAnyOrder("CREATED", "MODEL_CATALOG_CURRENT_VERSION_CONFLICT");
            Attempt winner = "CREATED".equals(firstAttempt.code()) ? firstAttempt : secondAttempt;
            assertThat(winner.response().version()).isEqualTo(2);

            CatalogPublishResponse replay = publicationService.publish(
                    publisher,
                    winner.idempotencyKey(),
                    concurrentRequest
            );
            assertThat(replay.version()).isEqualTo(2);
            assertThat(replay.idempotentReplay()).isTrue();
        } finally {
            executor.shutdownNow();
        }

        assertThat(jdbcTemplate.queryForObject(
                "SELECT count(*) FROM model_catalog.catalog_versions",
                Integer.class
        )).isEqualTo(2);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT count(*) FROM model_catalog.catalog_versions WHERE is_current",
                Integer.class
        )).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject("""
                        SELECT item.display_name
                        FROM model_catalog.catalog_version_items item
                        JOIN model_catalog.catalog_versions version
                          ON version.id = item.catalog_version_id
                        WHERE version.version_no = 1
                        """,
                String.class
        )).isEqualTo("Wave Video Original");
        assertThat(jdbcTemplate.queryForObject("""
                        SELECT item.display_name
                        FROM model_catalog.catalog_version_items item
                        JOIN model_catalog.catalog_versions version
                          ON version.id = item.catalog_version_id
                        WHERE version.version_no = 2
                        """,
                String.class
        )).isEqualTo("Wave Video Updated");
    }

    private Attempt attemptPublish(
            SessionContext publisher,
            String idempotencyKey,
            PublishCatalogRequest request,
            CountDownLatch ready,
            CountDownLatch start
    ) throws InterruptedException {
        ready.countDown();
        start.await();
        try {
            return new Attempt(
                    idempotencyKey,
                    "CREATED",
                    publicationService.publish(publisher, idempotencyKey, request)
            );
        } catch (ApiException exception) {
            return new Attempt(idempotencyKey, exception.code(), null);
        }
    }

    private UUID seedActiveModel() {
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        jdbcTemplate.update("""
                        INSERT INTO model_catalog.providers (
                            id, provider_code, display_name, protocol_family, status
                        ) VALUES (?, ?, 'Wave Provider', 'openai_compatible', 'active')
                        """,
                providerId,
                "wave35-provider-" + providerId.toString().substring(0, 8)
        );
        jdbcTemplate.update("""
                        INSERT INTO model_catalog.models (
                            id, provider_id, model_code, display_name, capability_type,
                            parameter_schema, default_parameters, default_tenant_enabled,
                            sort_order, status
                        ) VALUES (?, ?, 'wave35-video-v1', 'Wave Video Original', 'video',
                                  '{}'::jsonb, '{"duration":10}'::jsonb, false, 10, 'active')
                        """,
                modelId,
                providerId
        );
        return modelId;
    }

    private AuthService.AuthenticatedSession platformAdmin(String prefix) {
        AuthService.AuthenticatedSession session = register(prefix);
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

    private AuthService.AuthenticatedSession register(String prefix) {
        String suffix = UUID.randomUUID().toString().replace("-", "").substring(0, 12);
        String username = prefix + "_" + suffix;
        return authService.register(
                new RegisterRequest(
                        username,
                        prefix + "." + suffix + "@example.com",
                        PASSWORD,
                        null,
                        ClientType.MANAGEMENT_WEB,
                        new DeviceRequest(
                                sha256(username),
                                1,
                                "Model Catalog Publication Integration Test",
                                "windows",
                                "x64",
                                "test"
                        )
                ),
                new AuthService.RequestMetadata("model-catalog-publication-integration-test")
        );
    }

    private SessionContext publishContext(SessionContext access) {
        return new SessionContext(
                access.sessionId(),
                access.userId(),
                access.username(),
                access.email(),
                access.tenantId(),
                access.tenantCode(),
                access.tenantName(),
                access.membershipId(),
                access.deviceId(),
                ClientType.MANAGEMENT_WEB,
                "platform_admin",
                Set.of("model_catalog.publish"),
                access.featurePolicies(),
                access.expiresAt()
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

    private static void prepareDatabase() {
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(),
                POSTGRES.getPassword()
        ); Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE lingframe_app LOGIN PASSWORD '" + APP_PASSWORD + "'");
            statement.execute("CREATE SCHEMA identity AUTHORIZATION lingframe_owner");
            statement.execute("GRANT USAGE ON SCHEMA identity TO lingframe_app");
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }

        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), OWNER_PASSWORD)
                .schemas("identity")
                .defaultSchema("identity")
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }

    private record Attempt(
            String idempotencyKey,
            String code,
            CatalogPublishResponse response
    ) {
    }
}
