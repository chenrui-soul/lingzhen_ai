package com.lingzhen.center.integration;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
class BillingWalletIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final String PASSWORD = "ValidPassword!123";

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    private JdbcTemplate ownerJdbcTemplate;
    private MockMvc mockMvc;

    @BeforeEach
    void setUp() {
        mockMvc = MockMvcBuilders.webAppContextSetup(applicationContext)
                .apply(springSecurity())
                .build();
        ownerJdbcTemplate = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(),
                POSTGRES.getPassword()
        ));
    }

    @Test
    void walletAndBootstrapKeepTheSameGlobalBalanceAcrossTenantSwitches() throws Exception {
        TestIdentity identity = identity("wallet-tenant");
        JsonNode registered = register(identity, "desktop");
        UUID userId = UUID.fromString(registered.path("user").path("id").asText());
        String firstToken = registered.path("accessToken").asText();

        assertThat(jdbcTemplate.queryForObject(
                "SELECT count(*) FROM billing.user_wallets WHERE user_id = ?",
                Integer.class,
                userId
        )).isEqualTo(1);
        ownerJdbcTemplate.update("""
                        UPDATE billing.user_wallets
                        SET available_balance = 125, updated_at = now(), row_version = row_version + 1
                        WHERE user_id = ?
                        """, userId);

        assertWalletAndBootstrap(firstToken, userId, 125);

        UUID secondTenantId = UUID.randomUUID();
        UUID memberRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'member'",
                UUID.class
        );
        jdbcTemplate.update(
                "INSERT INTO identity.tenants (id, tenant_code, display_name) VALUES (?, ?, ?)",
                secondTenantId,
                "wallet_" + compactId(),
                "Wallet Second Tenant"
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
                        .content(loginBody(identity, "desktop")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("tenant_selection_required"))
                .andReturn());
        JsonNode selected = json(mockMvc.perform(post("/api/v1/auth/select-tenant")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "tenantSelectionTicket", login.path("tenantSelectionTicket").asText(),
                                "tenantId", secondTenantId,
                                "device", device(identity.username())
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.tenant.id").value(secondTenantId.toString()))
                .andReturn());

        assertWalletAndBootstrap(selected.path("accessToken").asText(), userId, 125);
    }

    @Test
    void ledgerCursorReturnsOnlyTheAuthenticatedUsersEntries() throws Exception {
        JsonNode first = register(identity("ledger-first"), "desktop");
        JsonNode second = register(identity("ledger-second"), "desktop");
        UUID firstUserId = UUID.fromString(first.path("user").path("id").asText());
        UUID secondUserId = UUID.fromString(second.path("user").path("id").asText());
        addLedgerEntry(firstUserId, "first-1", 10, Instant.parse("2026-08-25T12:01:00Z"));
        addLedgerEntry(firstUserId, "first-2", 20, Instant.parse("2026-08-25T12:02:00Z"));
        addLedgerEntry(firstUserId, "first-3", 30, Instant.parse("2026-08-25T12:03:00Z"));
        addLedgerEntry(secondUserId, "second-only", 99, Instant.parse("2026-08-25T12:04:00Z"));
        String authorization = "Bearer " + first.path("accessToken").asText();

        JsonNode firstPage = json(mockMvc.perform(get("/api/v1/credits/ledger")
                        .header("Authorization", authorization)
                        .param("limit", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].businessId").value("first-3"))
                .andExpect(jsonPath("$.items[1].businessId").value("first-2"))
                .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                .andReturn());

        mockMvc.perform(get("/api/v1/credits/ledger")
                        .header("Authorization", authorization)
                        .param("limit", "2")
                        .param("cursor", firstPage.path("nextCursor").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].businessId").value("first-1"))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    void ledgerCursorIsStableWhenEntriesShareTheSameTimestamp() throws Exception {
        JsonNode registered = register(identity("ledger-tie"), "desktop");
        UUID userId = UUID.fromString(registered.path("user").path("id").asText());
        Instant createdAt = Instant.parse("2026-08-25T12:05:00Z");
        UUID lowerId = UUID.fromString("00000000-0000-4000-8000-000000000001");
        UUID higherId = UUID.fromString("00000000-0000-4000-8000-000000000002");
        addLedgerEntry(userId, lowerId, "same-time-lower", 10, createdAt);
        addLedgerEntry(userId, higherId, "same-time-higher", 20, createdAt);
        String authorization = "Bearer " + registered.path("accessToken").asText();

        JsonNode firstPage = json(mockMvc.perform(get("/api/v1/credits/ledger")
                        .header("Authorization", authorization)
                        .param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].businessId").value("same-time-higher"))
                .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                .andReturn());

        mockMvc.perform(get("/api/v1/credits/ledger")
                        .header("Authorization", authorization)
                        .param("limit", "1")
                        .param("cursor", firstPage.path("nextCursor").asText()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].businessId").value("same-time-lower"))
                .andExpect(jsonPath("$.nextCursor").doesNotExist());
    }

    @Test
    void bootstrapRejectsUnsafeWalletBalanceInsteadOfMaskingItAsUnavailable() throws Exception {
        JsonNode registered = register(identity("wallet-unsafe"), "desktop");
        UUID userId = UUID.fromString(registered.path("user").path("id").asText());
        ownerJdbcTemplate.update("""
                        UPDATE billing.user_wallets
                        SET available_balance = 9007199254740992,
                            updated_at = now(),
                            row_version = row_version + 1
                        WHERE user_id = ?
                        """, userId);

        mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", "Bearer " + registered.path("accessToken").asText()))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("CREDIT_VALUE_INVALID"));
    }

    @Test
    void walletEndpointsRejectAnonymousWrongTerminalMissingPermissionAndInvalidCursor() throws Exception {
        mockMvc.perform(get("/api/v1/credits/wallet"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        JsonNode management = register(identity("wallet-management"), "management_web");
        mockMvc.perform(get("/api/v1/credits/wallet")
                        .header("Authorization", "Bearer " + management.path("accessToken").asText()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        JsonNode desktop = register(identity("wallet-viewer"), "desktop");
        UUID membershipId = UUID.fromString(desktop.path("session").path("membershipId").asText());
        UUID viewerRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'viewer'",
                UUID.class
        );
        jdbcTemplate.update(
                "UPDATE identity.tenant_memberships SET role_id = ? WHERE id = ?",
                viewerRoleId,
                membershipId
        );
        mockMvc.perform(get("/api/v1/credits/wallet")
                        .header("Authorization", "Bearer " + desktop.path("accessToken").asText()))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        JsonNode permitted = register(identity("wallet-cursor"), "desktop");
        mockMvc.perform(get("/api/v1/credits/ledger")
                        .header("Authorization", "Bearer " + permitted.path("accessToken").asText())
                        .param("cursor", "invalid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CREDIT_LEDGER_CURSOR"));
    }

    private void assertWalletAndBootstrap(String token, UUID userId, long balance) throws Exception {
        String authorization = "Bearer " + token;
        mockMvc.perform(get("/api/v1/credits/wallet")
                        .header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.userId").value(userId.toString()))
                .andExpect(jsonPath("$.availableBalance").value(balance))
                .andExpect(jsonPath("$.reservedBalance").value(0))
                .andExpect(jsonPath("$.tenantId").doesNotExist());
        mockMvc.perform(get("/api/v1/desktop/bootstrap")
                        .header("Authorization", authorization))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.schemaVersion").value(1))
                .andExpect(jsonPath("$.credits.available").value(true))
                .andExpect(jsonPath("$.credits.balance").value(balance));
    }

    private void addLedgerEntry(UUID userId, String businessId, long balance, Instant createdAt) {
        addLedgerEntry(userId, UUID.randomUUID(), businessId, balance, createdAt);
    }

    private void addLedgerEntry(
            UUID userId,
            UUID entryId,
            String businessId,
            long balance,
            Instant createdAt
    ) {
        ownerJdbcTemplate.update("""
                        UPDATE billing.user_wallets
                        SET available_balance = ?, updated_at = ?, row_version = row_version + 1
                        WHERE user_id = ?
                        """, balance, OffsetDateTime.ofInstant(createdAt, ZoneOffset.UTC), userId);
        ownerJdbcTemplate.update("""
                        INSERT INTO billing.credit_ledger_entries (
                            id, user_id, entry_type, available_delta, reserved_delta,
                            available_after, reserved_after, business_type, business_id,
                            idempotency_key, created_at
                        ) VALUES (?, ?, 'recharge', ?, 0, ?, 0, 'integration', ?, ?, ?)
                        """,
                entryId,
                userId,
                10,
                balance,
                businessId,
                "integration:" + businessId + ":" + compactId(),
                OffsetDateTime.ofInstant(createdAt, ZoneOffset.UTC)
        );
    }

    private JsonNode register(TestIdentity identity, String clientType) throws Exception {
        return json(mockMvc.perform(post("/api/v1/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(registerBody(identity, clientType)))
                .andExpect(status().isCreated())
                .andReturn());
    }

    private byte[] registerBody(TestIdentity identity, String clientType) throws Exception {
        Map<String, Object> body = new LinkedHashMap<>();
        body.put("username", identity.username());
        body.put("email", identity.email());
        body.put("password", PASSWORD);
        body.put("clientType", clientType);
        body.put("device", device(identity.username()));
        return objectMapper.writeValueAsBytes(body);
    }

    private byte[] loginBody(TestIdentity identity, String clientType) throws Exception {
        return objectMapper.writeValueAsBytes(Map.of(
                "identity", identity.email(),
                "password", PASSWORD,
                "clientType", clientType,
                "device", device(identity.username())
        ));
    }

    private Map<String, Object> device(String seed) {
        return Map.of(
                "deviceHash", deviceHash(seed),
                "fingerprintVersion", 1,
                "displayName", "Billing Integration Device",
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
