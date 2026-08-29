package com.lingzhen.center.integration;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.security.SecureTokenGenerator;
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
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.List;
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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
class AuthFlowIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final String PASSWORD = "ValidPassword!123";

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private SecureTokenGenerator tokenGenerator;

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
    void registrationWithoutInvitationCreatesPersonalTenantOwnerAndSession() throws Exception {
        TestIdentity identity = identity("register-owner");

        JsonNode response = register(identity, "desktop");

        assertThat(response.path("status").asText()).isEqualTo("authenticated");
        assertThat(response.path("role").asText()).isEqualTo("owner");
        assertThat(response.path("refreshToken").asText()).isNotBlank();
        UUID userId = UUID.fromString(response.path("user").path("id").asText());
        Integer membershipCount = jdbcTemplate.queryForObject(
                "SELECT count(*) FROM identity.tenant_memberships WHERE user_id = ?",
                Integer.class,
                userId
        );
        assertThat(membershipCount).isEqualTo(1);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT password_algorithm FROM identity.users WHERE id = ?",
                String.class,
                userId
        )).isEqualTo("argon2id");
    }

    @Test
    void registrationWithInvitationJoinsSpecifiedTenantAndDoesNotCreateAnotherMembership() throws Exception {
        TestIdentity ownerIdentity = identity("invite-owner");
        JsonNode owner = register(ownerIdentity, "management_web");
        UUID tenantId = UUID.fromString(owner.path("tenant").path("id").asText());
        UUID inviterMembershipId = UUID.fromString(owner.path("session").path("membershipId").asText());
        UUID memberRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'member'",
                UUID.class
        );
        String invitationToken = tokenGenerator.generate().value();
        TestIdentity invitedIdentity = identity("invited-member");
        jdbcTemplate.update("""
                        INSERT INTO identity.tenant_invitations (
                            id, tenant_id, target_email, role_id, token_hash,
                            invited_by_membership_id, expires_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                UUID.randomUUID(),
                tenantId,
                invitedIdentity.email(),
                memberRoleId,
                tokenGenerator.hash(invitationToken),
                inviterMembershipId,
                java.sql.Timestamp.from(Instant.now().plus(1, ChronoUnit.HOURS))
        );

        JsonNode response = register(invitedIdentity, "desktop", invitationToken);

        assertThat(response.path("tenant").path("id").asText()).isEqualTo(tenantId.toString());
        assertThat(response.path("role").asText()).isEqualTo("member");
        UUID invitedUserId = UUID.fromString(response.path("user").path("id").asText());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT count(*) FROM identity.tenant_memberships WHERE user_id = ?",
                Integer.class,
                invitedUserId
        )).isEqualTo(1);
    }

    @Test
    void duplicateUsernameOrEmailIsRejectedWithoutPartialData() throws Exception {
        TestIdentity identity = identity("duplicate");
        register(identity, "desktop");

        mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(identity, "desktop", null)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("AUTH_IDENTITY_EXISTS"));
    }

    @Test
    void wrongPasswordIncrementsFailureCountAndReturnsGenericError() throws Exception {
        TestIdentity identity = identity("wrong-password");
        JsonNode registered = register(identity, "desktop");

        mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(identity, "WrongPassword!123", "desktop")))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"));

        UUID userId = UUID.fromString(registered.path("user").path("id").asText());
        assertThat(jdbcTemplate.queryForObject(
                "SELECT failed_login_count FROM identity.users WHERE id = ?",
                Integer.class,
                userId
        )).isEqualTo(1);
    }

    @Test
    void singleTenantLoginReusesDeviceRecordAndCreatesAuthenticatedSession() throws Exception {
        TestIdentity identity = identity("single-login");
        JsonNode registered = register(identity, "desktop");
        String deviceHash = deviceHash(identity.username());

        MvcResult login = mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(identity, PASSWORD, "desktop")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("authenticated"))
                .andReturn();

        JsonNode loggedIn = json(login);
        assertThat(loggedIn.path("session").path("clientType").asText()).isEqualTo("desktop");
        UUID tenantId = UUID.fromString(registered.path("tenant").path("id").asText());
        assertThat(jdbcTemplate.queryForObject("""
                        SELECT count(*) FROM identity.devices
                        WHERE tenant_id = ? AND client_type = 'desktop' AND device_hash = ?
                        """, Integer.class, tenantId, deviceHash))
                .isEqualTo(1);
    }

    @Test
    void multiTenantLoginRequiresTicketAndTicketCreatesChosenTenantSession() throws Exception {
        TestIdentity identity = identity("multi-tenant");
        JsonNode registered = register(identity, "desktop");
        UUID userId = UUID.fromString(registered.path("user").path("id").asText());
        UUID secondTenantId = UUID.randomUUID();
        UUID memberRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'member'",
                UUID.class
        );
        jdbcTemplate.update(
                "INSERT INTO identity.tenants (id, tenant_code, display_name) VALUES (?, ?, ?)",
                secondTenantId,
                "test_" + compactId(),
                "第二测试租户"
        );
        jdbcTemplate.update("""
                        INSERT INTO identity.tenant_memberships
                            (id, tenant_id, user_id, role_id, status, joined_at)
                        VALUES (?, ?, ?, ?, 'active', now())
                        """,
                UUID.randomUUID(),
                secondTenantId,
                userId,
                memberRoleId
        );

        JsonNode login = json(mockMvc.perform(post("/api/v1/auth/login")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(loginBody(identity, PASSWORD, "desktop")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("tenant_selection_required"))
                .andExpect(jsonPath("$.tenants.length()").value(2))
                .andReturn());

        Map<String, Object> selectBody = Map.of(
                "tenantSelectionTicket", login.path("tenantSelectionTicket").asText(),
                "tenantId", secondTenantId,
                "device", device(identity.username())
        );
        mockMvc.perform(post("/api/v1/auth/select-tenant")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(selectBody)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("authenticated"))
                .andExpect(jsonPath("$.tenant.id").value(secondTenantId.toString()));
    }

    @Test
    void concurrentRefreshAllowsOneRotationAndReplayRevokesTheSessionFamily() throws Exception {
        TestIdentity identity = identity("refresh-race");
        JsonNode registered = register(identity, "desktop");
        String refreshToken = registered.path("refreshToken").asText();
        String accessToken = registered.path("accessToken").asText();
        CountDownLatch start = new CountDownLatch(1);
        ExecutorService executor = Executors.newFixedThreadPool(2);
        try {
            List<Future<String>> futures = new ArrayList<>();
            for (int index = 0; index < 2; index++) {
                futures.add(executor.submit(() -> {
                    start.await();
                    try {
                        authService.refresh(refreshToken);
                        return "success";
                    } catch (ApiException exception) {
                        return exception.code();
                    }
                }));
            }
            start.countDown();
            Set<String> outcomes = Set.of(futures.get(0).get(), futures.get(1).get());
            assertThat(outcomes).containsExactlyInAnyOrder("success", "REFRESH_TOKEN_REUSED");
        } finally {
            executor.shutdownNow();
        }

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logoutRevokesSessionSoExistingAccessTokenStopsWorking() throws Exception {
        TestIdentity identity = identity("logout");
        JsonNode registered = register(identity, "desktop");
        String accessToken = registered.path("accessToken").asText();

        mockMvc.perform(post("/api/v1/auth/logout")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/auth/me")
                        .header("Authorization", "Bearer " + accessToken))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void desktopTokenCannotCallManagementApiEvenWhenRoleIsOwner() throws Exception {
        TestIdentity identity = identity("terminal-boundary");
        JsonNode registered = register(identity, "desktop");

        mockMvc.perform(get("/api/v1/management/probe")
                        .header("Authorization", "Bearer " + registered.path("accessToken").asText()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));
    }

    @Test
    void desktopBootstrapReturnsCurrentIdentityAndStableEmptyCatalogs() throws Exception {
        TestIdentity identity = identity("desktop-bootstrap");
        JsonNode registered = register(identity, "desktop");

        mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", "Bearer "
                                + registered.path("accessToken").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value(1))
                .andExpect(jsonPath("$.user.id").value(
                        registered.path("user").path("id").asText()))
                .andExpect(jsonPath("$.tenant.id").value(
                        registered.path("tenant").path("id").asText()))
                .andExpect(jsonPath("$.membership.id").value(
                        registered.path("session").path("membershipId").asText()))
                .andExpect(jsonPath("$.permissions").isArray())
                .andExpect(jsonPath("$.permissions[?(@ == 'desktop.bootstrap')]").exists())
                .andExpect(jsonPath("$.features.infiniteCanvas").value(false))
                .andExpect(jsonPath("$.credits.available").value(true))
                .andExpect(jsonPath("$.credits.balance").value(0))
                .andExpect(jsonPath("$.models").isEmpty())
                .andExpect(jsonPath("$.skills").isEmpty());
    }

    @Test
    void desktopWorkspaceAndDoubaoMetadataAreOwnedByCurrentSessionAndUseOptimisticLocking() throws Exception {
        TestIdentity identity = identity("desktop-wave4");
        JsonNode registered = register(identity, "desktop");
        String accessToken = registered.path("accessToken").asText();
        String authorization = "Bearer " + accessToken;

        mockMvc.perform(put("/api/v1/desktop/workspace/snapshot")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "expectedRevision": 0,
                                  "snapshot": {
                                    "currentProjectId": "project-1",
                                    "projects": [{
                                      "id": "project-1",
                                      "name": "Wave 4 项目",
                                      "updatedAt": "2026-08-25T10:00:00Z",
                                      "deletedAt": null
                                    }],
                                    "assets": [],
                                    "textConversations": [],
                                    "tasks": []
                                  }
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.revision").value(1))
                .andExpect(jsonPath("$.contentHash").isNotEmpty());

        mockMvc.perform(put("/api/v1/desktop/workspace/snapshot")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedRevision\":0,\"snapshot\":{}}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("DESKTOP_WORKSPACE_CONFLICT"));

        mockMvc.perform(put("/api/v1/desktop/workspace/snapshot")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"expectedRevision\":1,\"snapshot\":{\"filePath\":\"C:\\\\private.mp4\"}}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("DESKTOP_WORKSPACE_INVALID"));

        mockMvc.perform(put("/api/v1/desktop/doubao-accounts/account_wave4")
                        .header("Authorization", authorization)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {
                                  "displayName": "Wave 4 豆包账号",
                                  "loginState": "logged_in",
                                  "loginSummary": "本机检测已登录",
                                  "lastCheckedAt": "2026-08-25T10:01:00Z"
                                }
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.accountId").value("account_wave4"));

        mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recentProjects[0].id").value("project-1"))
                .andExpect(jsonPath("$.doubaoAccounts[0].accountId").value("account_wave4"));

        mockMvc.perform(delete("/api/v1/desktop/doubao-accounts/account_wave4")
                        .header("Authorization", authorization))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/v1/desktop/doubao-accounts")
                        .header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$").isEmpty());
    }

    @Test
    void anonymousUserCannotLoadDesktopBootstrap() throws Exception {
        mockMvc.perform(get("/api/v1/desktop/bootstrap"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));
    }

    @Test
    void managementWebTokenCannotLoadDesktopBootstrap() throws Exception {
        TestIdentity identity = identity("management-bootstrap");
        JsonNode registered = register(identity, "management_web");

        mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", "Bearer "
                                + registered.path("accessToken").asText()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));
    }

    @Test
    void desktopUserWithoutBootstrapPermissionReceivesSpecificForbiddenError() throws Exception {
        TestIdentity identity = identity("bootstrap-forbidden");
        JsonNode registered = register(identity, "desktop");
        UUID membershipId = UUID.fromString(
                registered.path("session").path("membershipId").asText()
        );
        UUID viewerRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'viewer'",
                UUID.class
        );
        jdbcTemplate.update(
                "UPDATE identity.tenant_memberships SET role_id = ? WHERE id = ?",
                viewerRoleId,
                membershipId
        );

        mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", "Bearer "
                                + registered.path("accessToken").asText()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("DESKTOP_BOOTSTRAP_FORBIDDEN"));
    }

    @Test
    void managementRefreshUsesHttpOnlyCookieAndRequiresDoubleSubmitCsrf() throws Exception {
        TestIdentity identity = identity("web-cookie");
        MvcResult registration = mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(identity, "management_web", null)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.refreshToken").doesNotExist())
                .andReturn();
        Map<String, String> cookies = responseCookies(registration);

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .cookie(new Cookie("LZ_REFRESH", cookies.get("LZ_REFRESH")))
                        .cookie(new Cookie("LZ_CSRF", cookies.get("LZ_CSRF"))))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_VALIDATION_FAILED"));

        mockMvc.perform(post("/api/v1/auth/refresh")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}")
                        .cookie(new Cookie("LZ_REFRESH", cookies.get("LZ_REFRESH")))
                        .cookie(new Cookie("LZ_CSRF", cookies.get("LZ_CSRF")))
                        .header("X-CSRF-Token", cookies.get("LZ_CSRF")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("authenticated"))
                .andExpect(jsonPath("$.refreshToken").doesNotExist());
    }

    private JsonNode register(TestIdentity identity, String clientType) throws Exception {
        return register(identity, clientType, null);
    }

    private JsonNode register(
            TestIdentity identity,
            String clientType,
            String invitationToken
    ) throws Exception {
        return json(mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(identity, clientType, invitationToken)))
                .andExpect(status().isCreated())
                .andReturn());
    }

    private byte[] registerBody(
            TestIdentity identity,
            String clientType,
            String invitationToken
    ) throws Exception {
        Map<String, Object> body = new java.util.LinkedHashMap<>();
        body.put("username", identity.username());
        body.put("email", identity.email());
        body.put("password", PASSWORD);
        if (invitationToken != null) {
            body.put("invitationToken", invitationToken);
        }
        body.put("clientType", clientType);
        body.put("device", device(identity.username()));
        return objectMapper.writeValueAsBytes(body);
    }

    private byte[] loginBody(
            TestIdentity identity,
            String password,
            String clientType
    ) throws Exception {
        return objectMapper.writeValueAsBytes(Map.of(
                "identity", identity.email(),
                "password", password,
                "clientType", clientType,
                "device", device(identity.username())
        ));
    }

    private Map<String, Object> device(String seed) {
        return Map.of(
                "deviceHash", deviceHash(seed),
                "fingerprintVersion", 1,
                "displayName", "Integration Test Device",
                "platform", "windows",
                "architecture", "x64",
                "appVersion", "test"
        );
    }

    private String deviceHash(String seed) {
        try {
            return java.util.HexFormat.of().formatHex(
                    java.security.MessageDigest.getInstance("SHA-256")
                            .digest(seed.getBytes(StandardCharsets.UTF_8))
            );
        } catch (java.security.NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private Map<String, String> responseCookies(MvcResult result) {
        Map<String, String> cookies = new java.util.HashMap<>();
        for (String header : result.getResponse().getHeaders("Set-Cookie")) {
            String pair = header.substring(0, header.indexOf(';'));
            int separator = pair.indexOf('=');
            cookies.put(pair.substring(0, separator), pair.substring(separator + 1));
        }
        return cookies;
    }

    private TestIdentity identity(String prefix) {
        String suffix = compactId();
        return new TestIdentity(prefix + "_" + suffix, prefix + "." + suffix + "@example.com");
    }

    private String compactId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private record TestIdentity(String username, String email) {
    }
}
