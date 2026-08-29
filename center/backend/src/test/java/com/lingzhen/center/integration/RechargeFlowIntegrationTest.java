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
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.context.WebApplicationContext;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.ObjectMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;

@SpringBootTest
class RechargeFlowIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final String PASSWORD = "ValidPassword!123";
    private static final String CSRF_TOKEN = "wave54-recharge-csrf-token";

    @Autowired
    private WebApplicationContext applicationContext;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private AuthService authService;

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
    void activePackageOrderOwnershipAndPaidIdempotencyFormOneClosedLoop() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("recharge-admin");
        AuthService.AuthenticatedSession buyer = register("recharge-buyer", ClientType.DESKTOP);
        AuthService.AuthenticatedSession other = register("recharge-other", ClientType.DESKTOP);
        JsonNode rechargePackage = createActivePackage(admin, "starter_110");
        UUID packageId = UUID.fromString(rechargePackage.path("id").asText());

        JsonNode packages = json(mockMvc.perform(get("/api/v1/recharge-packages")
                        .header("Authorization", bearer(buyer)))
                .andExpect(status().isOk())
                .andReturn());
        assertThat(packages.path("items").toString()).contains(packageId.toString());

        String idempotencyKey = "order-create-" + compactId();
        byte[] orderBody = objectMapper.writeValueAsBytes(Map.of(
                "packageId", packageId,
                "paymentChannel", "sandbox"
        ));
        JsonNode created = json(mockMvc.perform(post("/api/v1/recharge-orders")
                        .header("Authorization", bearer(buyer))
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.idempotentReplay").value(false))
                .andReturn());
        UUID orderId = UUID.fromString(created.path("id").asText());

        mockMvc.perform(post("/api/v1/recharge-orders")
                        .header("Authorization", bearer(buyer))
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(orderBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(orderId.toString()))
                .andExpect(jsonPath("$.idempotentReplay").value(true));

        mockMvc.perform(post("/api/v1/recharge-orders")
                        .header("Authorization", bearer(buyer))
                        .header("Idempotency-Key", idempotencyKey)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "packageId", UUID.randomUUID(),
                                "paymentChannel", "sandbox"
                        ))))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CREDIT_IDEMPOTENCY_CONFLICT"));

        mockMvc.perform(get("/api/v1/recharge-orders/{orderId}", orderId)
                        .header("Authorization", bearer(other)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("RECHARGE_ORDER_NOT_FOUND"));

        byte[] paidBody = paymentBody("paid", "paid-event-" + compactId(), 990L);
        mockMvc.perform(post("/api/v1/management/credits/sandbox/orders/{orderId}/events", orderId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(paidBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("paid"))
                .andExpect(jsonPath("$.idempotentReplay").value(false))
                .andExpect(jsonPath("$.availableBalance").value(110))
                .andExpect(jsonPath("$.order.status").value("paid"));

        mockMvc.perform(post("/api/v1/management/credits/sandbox/orders/{orderId}/events", orderId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(paidBody))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("paid"))
                .andExpect(jsonPath("$.idempotentReplay").value(true))
                .andExpect(jsonPath("$.availableBalance").value(110));

        mockMvc.perform(get("/api/v1/credits/wallet")
                        .header("Authorization", bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableBalance").value(110));
        assertThat(ownerJdbcTemplate.queryForObject(
                "SELECT count(*) FROM billing.credit_ledger_entries WHERE recharge_order_id = ?",
                Integer.class,
                orderId
        )).isEqualTo(1);
    }

    @Test
    void administratorGrantCreditsIsIdempotentAndVisibleInDesktopLedger() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("grant-admin");
        AuthService.AuthenticatedSession buyer = register("grant-buyer", ClientType.DESKTOP);
        UUID targetUserId = buyer.access().userId();
        String idempotencyKey = "admin-grant-" + compactId();
        byte[] body = objectMapper.writeValueAsBytes(Map.of(
                "userId", targetUserId,
                "credits", 75,
                "reason", "测试账号补充积分",
                "idempotencyKey", idempotencyKey
        ));

        mockMvc.perform(post("/api/v1/management/credits/grants")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotentReplay").value(false))
                .andExpect(jsonPath("$.availableBalance").value(75));

        mockMvc.perform(post("/api/v1/management/credits/grants")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.idempotentReplay").value(true))
                .andExpect(jsonPath("$.availableBalance").value(75));

        mockMvc.perform(get("/api/v1/credits/ledger")
                        .header("Authorization", bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].entryType").value("manual_adjustment"))
                .andExpect(jsonPath("$.items[0].availableDelta").value(75));
    }

    @Test
    void failedCancelledAndExpiredOrdersNeverIncreaseWalletBalance() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("recharge-state-admin");
        AuthService.AuthenticatedSession buyer = register("recharge-state-buyer", ClientType.DESKTOP);
        UUID packageId = UUID.fromString(createActivePackage(admin, "state_100").path("id").asText());

        UUID failed = createOrder(buyer, packageId, "failed");
        UUID cancelled = createOrder(buyer, packageId, "cancelled");
        UUID expired = createOrder(buyer, packageId, "expired");
        OffsetDateTime now = OffsetDateTime.now(ZoneOffset.UTC);
        ownerJdbcTemplate.update("""
                        UPDATE billing.recharge_orders
                        SET created_at = ?, expires_at = ?, updated_at = ?
                        WHERE id = ?
                        """,
                now.minusHours(1),
                now.minusMinutes(1),
                now.minusMinutes(1),
                expired
        );

        simulate(admin, failed, "failed", "failed-event-" + compactId(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("failed"))
                .andExpect(jsonPath("$.order.status").value("closed"));
        simulate(admin, cancelled, "cancelled", "cancelled-event-" + compactId(), null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("cancelled"))
                .andExpect(jsonPath("$.order.status").value("closed"));
        simulate(admin, expired, "paid", "expired-event-" + compactId(), 990L)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("expired"))
                .andExpect(jsonPath("$.order.status").value("closed"));

        mockMvc.perform(get("/api/v1/credits/wallet")
                        .header("Authorization", bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableBalance").value(0));
        assertThat(ownerJdbcTemplate.queryForObject(
                "SELECT count(*) FROM billing.credit_ledger_entries WHERE recharge_order_id IN (?, ?, ?)",
                Integer.class,
                failed,
                cancelled,
                expired
        )).isZero();
    }

    @Test
    void desktopManualRechargeIsReviewedExactlyOnceAndOwnerCanCancelPendingRequest() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("manual-review-admin");
        AuthService.AuthenticatedSession buyer = register("manual-review-buyer", ClientType.DESKTOP);
        AuthService.AuthenticatedSession other = register("manual-review-other", ClientType.DESKTOP);
        UUID packageId = UUID.fromString(createActivePackage(admin, "manual_100").path("id").asText());

        JsonNode created = json(mockMvc.perform(post("/api/v1/recharge-orders")
                        .header("Authorization", bearer(buyer))
                        .header("Idempotency-Key", "manual-order-" + compactId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "packageId", packageId,
                                "paymentChannel", "manual_transfer",
                                "note", "已完成线下转账"
                        ))))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("manual_review"))
                .andExpect(jsonPath("$.submissionNote").value("已完成线下转账"))
                .andReturn());
        UUID orderId = UUID.fromString(created.path("id").asText());

        mockMvc.perform(get("/api/v1/recharge-orders/{orderId}", orderId)
                        .header("Authorization", bearer(other)))
                .andExpect(status().isNotFound());

        mockMvc.perform(post("/api/v1/management/credits/manual/orders/{orderId}/approve", orderId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of("reason", "已核实线下款项到账"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("approved"))
                .andExpect(jsonPath("$.idempotentReplay").value(false));

        mockMvc.perform(post("/api/v1/management/credits/manual/orders/{orderId}/approve", orderId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of("reason", "重复点击确认"))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.result").value("approved"))
                .andExpect(jsonPath("$.idempotentReplay").value(true));

        mockMvc.perform(get("/api/v1/credits/wallet")
                        .header("Authorization", bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.availableBalance").value(110));
        assertThat(ownerJdbcTemplate.queryForObject(
                "SELECT count(*) FROM billing.credit_ledger_entries WHERE recharge_order_id = ?",
                Integer.class,
                orderId
        )).isEqualTo(1);

        JsonNode cancellable = json(mockMvc.perform(post("/api/v1/recharge-orders")
                        .header("Authorization", bearer(buyer))
                        .header("Idempotency-Key", "manual-cancel-" + compactId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "packageId", packageId,
                                "paymentChannel", "manual_transfer"
                        ))))
                .andExpect(status().isCreated())
                .andReturn());
        UUID cancellableId = UUID.fromString(cancellable.path("id").asText());
        mockMvc.perform(post("/api/v1/recharge-orders/{orderId}/cancel", cancellableId)
                        .header("Authorization", bearer(buyer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("closed"));
    }

    @Test
    void managementWritesRequireManagementTerminalPermissionAndCsrf() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("recharge-security-admin");
        AuthService.AuthenticatedSession tenantOwner = register(
                "recharge-security-owner", ClientType.MANAGEMENT_WEB
        );
        AuthService.AuthenticatedSession desktop = register(
                "recharge-security-desktop", ClientType.DESKTOP
        );
        byte[] body = createPackageBody("security_100");

        mockMvc.perform(post("/api/v1/management/credits/packages")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isUnauthorized());

        mockMvc.perform(post("/api/v1/management/credits/packages")
                        .header("Authorization", bearer(desktop))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden());

        mockMvc.perform(post("/api/v1/management/credits/packages")
                        .header("Authorization", bearer(tenantOwner))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        mockMvc.perform(post("/api/v1/management/credits/packages")
                        .header("Authorization", bearer(admin))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CSRF_VALIDATION_FAILED"));

        mockMvc.perform(get("/api/v1/recharge-packages")
                        .header("Authorization", bearer(admin)))
                .andExpect(status().isForbidden());
    }

    private JsonNode createActivePackage(
            AuthService.AuthenticatedSession admin,
            String code
    ) throws Exception {
        JsonNode created = json(mockMvc.perform(post("/api/v1/management/credits/packages")
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(createPackageBody(code)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("draft"))
                .andReturn());
        UUID packageId = UUID.fromString(created.path("id").asText());
        return json(mockMvc.perform(put("/api/v1/management/credits/packages/{packageId}", packageId)
                        .header("Authorization", bearer(admin))
                        .header("X-CSRF-Token", CSRF_TOKEN)
                        .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "displayName", "Starter 110",
                                "cashAmountCents", 990,
                                "creditAmount", 100,
                                "bonusCredits", 10,
                                "status", "active",
                                "sortOrder", 10,
                                "rowVersion", created.path("rowVersion").longValue()
                        ))))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("active"))
                .andExpect(jsonPath("$.rowVersion").value(1))
                .andReturn());
    }

    private UUID createOrder(
            AuthService.AuthenticatedSession buyer,
            UUID packageId,
            String seed
    ) throws Exception {
        JsonNode created = json(mockMvc.perform(post("/api/v1/recharge-orders")
                        .header("Authorization", bearer(buyer))
                        .header("Idempotency-Key", "order-" + seed + "-" + compactId())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsBytes(Map.of(
                                "packageId", packageId,
                                "paymentChannel", "sandbox"
                        ))))
                .andExpect(status().isCreated())
                .andReturn());
        UUID orderId = UUID.fromString(created.path("id").asText());
        return orderId;
    }

    private org.springframework.test.web.servlet.ResultActions simulate(
            AuthService.AuthenticatedSession admin,
            UUID orderId,
            String outcome,
            String eventId,
            Long amount
    ) throws Exception {
        return mockMvc.perform(post(
                        "/api/v1/management/credits/sandbox/orders/{orderId}/events", orderId
                )
                .header("Authorization", bearer(admin))
                .header("X-CSRF-Token", CSRF_TOKEN)
                .cookie(new Cookie("LZ_CSRF", CSRF_TOKEN))
                .contentType(MediaType.APPLICATION_JSON)
                .content(paymentBody(outcome, eventId, amount)));
    }

    private byte[] createPackageBody(String code) throws Exception {
        return objectMapper.writeValueAsBytes(Map.of(
                "code", code,
                "displayName", "Starter 110",
                "cashAmountCents", 990,
                "creditAmount", 100,
                "bonusCredits", 10,
                "sortOrder", 10
        ));
    }

    private byte[] paymentBody(String outcome, String eventId, Long amount) throws Exception {
        if (amount == null) {
            return objectMapper.writeValueAsBytes(Map.of(
                    "outcome", outcome,
                    "eventId", eventId
            ));
        }
        return objectMapper.writeValueAsBytes(Map.of(
                "outcome", outcome,
                "eventId", eventId,
                "cashAmountCents", amount
        ));
    }

    private AuthService.AuthenticatedSession platformAdmin(String prefix) {
        AuthService.AuthenticatedSession session = register(prefix, ClientType.MANAGEMENT_WEB);
        UUID roleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'platform_admin'",
                UUID.class
        );
        jdbcTemplate.update("""
                        INSERT INTO identity.platform_role_assignments (id, user_id, role_id, status)
                        VALUES (?, ?, ?, 'active')
                        """, UUID.randomUUID(), session.access().userId(), roleId);
        return session;
    }

    private AuthService.AuthenticatedSession register(String prefix, ClientType clientType) {
        String suffix = compactId();
        String username = prefix + "_" + suffix;
        return authService.register(
                new RegisterRequest(
                        username,
                        prefix + "." + suffix + "@example.com",
                        PASSWORD,
                        null,
                        clientType,
                        new DeviceRequest(
                                sha256(username), 1, "Recharge Integration Test",
                                "windows", "x64", "test"
                        )
                ),
                new AuthService.RequestMetadata("recharge-integration-test")
        );
    }

    private String bearer(AuthService.AuthenticatedSession session) {
        return "Bearer " + session.accessToken();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private String compactId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
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
