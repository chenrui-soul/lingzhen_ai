package com.lingzhen.center.integration;

import com.lingzhen.center.model.dto.auth.DeviceRequest;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.AuthService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
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
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.security.test.web.servlet.setup.SecurityMockMvcConfigurers.springSecurity;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
class CreditsManagementIntegrationTest extends PostgreSqlIdentityTestSupport {

    private static final String PASSWORD = "ValidPassword!123";

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
    private BillingFixture fixtureToClean;

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

    @AfterEach
    void cleanBillingFixture() {
        if (fixtureToClean == null) {
            return;
        }
        ownerJdbcTemplate.update(
                "DELETE FROM billing.credit_reservations WHERE id = ?",
                fixtureToClean.reservationId()
        );
        ownerJdbcTemplate.update(
                "DELETE FROM billing.recharge_orders WHERE id = ?",
                fixtureToClean.orderId()
        );
        ownerJdbcTemplate.update(
                "DELETE FROM billing.model_price_versions WHERE id = ?",
                fixtureToClean.priceVersionId()
        );
        ownerJdbcTemplate.update(
                "DELETE FROM billing.recharge_packages WHERE id = ?",
                fixtureToClean.packageId()
        );
        ownerJdbcTemplate.update(
                "DELETE FROM model_catalog.models WHERE id = ?",
                fixtureToClean.modelId()
        );
        ownerJdbcTemplate.update(
                "DELETE FROM model_catalog.providers WHERE id = ?",
                fixtureToClean.providerId()
        );
        fixtureToClean = null;
    }

    @Test
    void platformAdminCanAuditAllFourReadOnlyViewsWithoutSensitiveFields() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("credit-audit-admin");
        AuthService.AuthenticatedSession subject = register("credit-audit-subject", ClientType.DESKTOP);
        BillingFixture fixture = billingFixture(subject);
        String authorization = bearer(admin);

        mockMvc.perform(get("/api/v1/management/credits/wallets")
                        .header("Authorization", authorization)
                        .param("keyword", subject.access().email())
                        .param("status", "active"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(subject.access().userId().toString()))
                .andExpect(jsonPath("$.items[0].availableBalance").value(480))
                .andExpect(jsonPath("$.items[0].tenantId").doesNotExist())
                .andExpect(jsonPath("$.items[0].rowVersion").doesNotExist());

        mockMvc.perform(get("/api/v1/management/credits/orders")
                        .header("Authorization", authorization)
                        .param("keyword", fixture.orderNo())
                        .param("status", "manual_review"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].orderNo").value(fixture.orderNo()))
                .andExpect(jsonPath("$.items[0].channelTradeNo").doesNotExist())
                .andExpect(jsonPath("$.items[0].idempotencyKey").doesNotExist());

        mockMvc.perform(get("/api/v1/management/credits/ledger")
                        .header("Authorization", authorization)
                        .param("keyword", fixture.businessId())
                        .param("entryType", "recharge"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].businessId").value(fixture.businessId()))
                .andExpect(jsonPath("$.items[0].idempotencyKey").doesNotExist())
                .andExpect(jsonPath("$.items[0].operatorUserId").doesNotExist());

        mockMvc.perform(get("/api/v1/management/credits/reservations/anomalies")
                        .header("Authorization", authorization)
                        .param("keyword", fixture.taskId())
                        .param("anomalyType", "expired"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].taskId").value(fixture.taskId()))
                .andExpect(jsonPath("$.items[0].anomalyType").value("expired"))
                .andExpect(jsonPath("$.items[0].idempotencyKey").doesNotExist())
                .andExpect(jsonPath("$.items[0].priceVersionId").doesNotExist());
    }

    @Test
    void endpointsRejectAnonymousDesktopAndManagementUsersWithoutCreditsManage() throws Exception {
        mockMvc.perform(get("/api/v1/management/credits/wallets"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTHENTICATION_REQUIRED"));

        AuthService.AuthenticatedSession desktop = register("credit-audit-desktop", ClientType.DESKTOP);
        mockMvc.perform(get("/api/v1/management/credits/wallets")
                        .header("Authorization", bearer(desktop)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));

        AuthService.AuthenticatedSession tenantOwner = register(
                "credit-audit-owner", ClientType.MANAGEMENT_WEB
        );
        mockMvc.perform(get("/api/v1/management/credits/wallets")
                        .header("Authorization", bearer(tenantOwner)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PERMISSION_DENIED"));
    }

    @Test
    void paginationFilterBoundariesAndCrossViewCursorAreEnforced() throws Exception {
        AuthService.AuthenticatedSession admin = platformAdmin("credit-audit-page");
        register("credit-audit-page-subject", ClientType.DESKTOP);
        String authorization = bearer(admin);

        JsonNode firstPage = json(mockMvc.perform(get("/api/v1/management/credits/wallets")
                        .header("Authorization", authorization)
                        .param("limit", "1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                .andReturn());

        mockMvc.perform(get("/api/v1/management/credits/orders")
                        .header("Authorization", authorization)
                        .param("cursor", firstPage.path("nextCursor").asText()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CREDITS_MANAGEMENT_CURSOR"));

        mockMvc.perform(get("/api/v1/management/credits/wallets")
                        .header("Authorization", authorization)
                        .param("limit", "101"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PAGE_REQUEST"));

        mockMvc.perform(get("/api/v1/management/credits/orders")
                        .header("Authorization", authorization)
                        .param("status", "not-valid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_CREDIT_FILTER"));
    }

    private BillingFixture billingFixture(AuthService.AuthenticatedSession subject) {
        UUID userId = subject.access().userId();
        UUID tenantId = subject.access().tenantId();
        Instant now = Instant.now();
        UUID packageId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        UUID priceVersionId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        UUID reservationId = UUID.randomUUID();
        String suffix = compactId();
        String orderNo = "LZ" + suffix.toUpperCase();
        String businessId = "audit-business-" + suffix;
        String taskId = "audit-task-" + suffix;

        ownerJdbcTemplate.update("""
                        UPDATE billing.user_wallets
                        SET available_balance = 480, reserved_balance = 20,
                            updated_at = ?, row_version = row_version + 1
                        WHERE user_id = ?
                        """, offset(now), userId);
        ownerJdbcTemplate.update("""
                        INSERT INTO billing.recharge_packages (
                            id, package_code, display_name, cash_amount_cents,
                            credit_amount, bonus_credits, status
                        ) VALUES (?, ?, 'Audit package', 990, 100, 10, 'active')
                        """, packageId, "audit_" + suffix.toLowerCase());
        ownerJdbcTemplate.update("""
                        INSERT INTO billing.recharge_orders (
                            id, order_no, user_id, package_id, package_code_snapshot,
                            cash_amount_cents, credit_amount, bonus_credits, payment_channel,
                            channel_trade_no, status, idempotency_key, expires_at
                        ) VALUES (?, ?, ?, ?, ?, 990, 100, 10, 'wechat', ?,
                                  'manual_review', ?, ?)
                        """,
                orderId, orderNo, userId, packageId, "audit_" + suffix.toLowerCase(),
                "private-trade-" + suffix, "private-order-key-" + suffix, offset(now.plusSeconds(900)));

        ownerJdbcTemplate.update("""
                        INSERT INTO model_catalog.providers (
                            id, provider_code, display_name, protocol_family, status
                        ) VALUES (?, ?, 'Audit provider', 'openai_compatible', 'active')
                        """, providerId, "audit_" + suffix.toLowerCase());
        ownerJdbcTemplate.update("""
                        INSERT INTO model_catalog.models (
                            id, provider_id, model_code, display_name, capability_type,
                            parameter_schema, default_parameters, status
                        ) VALUES (?, ?, ?, 'Audit model', 'video', '{}'::jsonb, '{}'::jsonb, 'active')
                        """, modelId, providerId, "audit_" + suffix.toLowerCase());
        ownerJdbcTemplate.update("""
                        INSERT INTO billing.model_price_versions (
                            id, model_id, version_no, pricing_unit, base_credits,
                            max_reserve_credits, content_hash, status, activated_at
                        ) VALUES (?, ?, 1, 'request', 10, 20, ?, 'active', ?)
                        """, priceVersionId, modelId, "a".repeat(64), offset(now.minusSeconds(3600)));
        ownerJdbcTemplate.update("""
                        INSERT INTO billing.credit_reservations (
                            id, user_id, tenant_id, task_id, attempt_id, client_request_id,
                            price_version_id, reserved_credits, status, idempotency_key,
                            expires_at, created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, 20, 'reserved', ?, ?, ?, ?)
                        """,
                reservationId, userId, tenantId, taskId, "attempt-" + suffix,
                "request-" + suffix, priceVersionId, "private-reservation-key-" + suffix,
                offset(now.minusSeconds(60)), offset(now.minusSeconds(600)), offset(now.minusSeconds(300)));
        ownerJdbcTemplate.update("""
                        INSERT INTO billing.credit_ledger_entries (
                            id, user_id, tenant_id, entry_type, available_delta, reserved_delta,
                            available_after, reserved_after, business_type, business_id,
                            idempotency_key, created_at
                        ) VALUES (?, ?, ?, 'recharge', 100, 0, 480, 20,
                                  'recharge_order', ?, ?, ?)
                        """,
                UUID.randomUUID(), userId, tenantId, businessId,
                "private-ledger-key-" + suffix, offset(now.minusSeconds(120)));
        fixtureToClean = new BillingFixture(
                orderNo,
                businessId,
                taskId,
                packageId,
                providerId,
                modelId,
                priceVersionId,
                orderId,
                reservationId
        );
        return fixtureToClean;
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
                                sha256(username), 1, "Credits Management Test",
                                "windows", "x64", "test"
                        )
                ),
                new AuthService.RequestMetadata("credits-management-integration-test")
        );
    }

    private String bearer(AuthService.AuthenticatedSession session) {
        return "Bearer " + session.accessToken();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return objectMapper.readTree(result.getResponse().getContentAsByteArray());
    }

    private OffsetDateTime offset(Instant instant) {
        return OffsetDateTime.ofInstant(instant, ZoneOffset.UTC);
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

    private record BillingFixture(
            String orderNo,
            String businessId,
            String taskId,
            UUID packageId,
            UUID providerId,
            UUID modelId,
            UUID priceVersionId,
            UUID orderId,
            UUID reservationId
    ) {
    }
}
