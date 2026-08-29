package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.ManagementCreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditReservationAnomalyPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditWalletPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementRechargeOrderPageResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.CreditsManagementRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class CreditsManagementServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T12:00:00Z");

    private final CreditsManagementRepository repository = mock(CreditsManagementRepository.class);
    private final CreditsManagementServiceImpl service = new CreditsManagementServiceImpl(
            repository,
            Clock.fixed(NOW, ZoneOffset.UTC)
    );

    @Test
    void walletsUseStableCursorAndKeepSensitiveDataOutOfTheContract() {
        SessionContext context = managementContext();
        CreditsManagementRepository.WalletRow first = walletRow(
                "00000000-0000-4000-8000-000000000003", "2026-08-25T11:03:00Z"
        );
        CreditsManagementRepository.WalletRow second = walletRow(
                "00000000-0000-4000-8000-000000000002", "2026-08-25T11:02:00Z"
        );
        CreditsManagementRepository.WalletRow lookahead = walletRow(
                "00000000-0000-4000-8000-000000000001", "2026-08-25T11:01:00Z"
        );
        when(repository.findWallets("alice", "active", null, null, 3))
                .thenReturn(List.of(first, second, lookahead));

        ManagementCreditWalletPageResponse response = service.wallets(
                context, null, 2, " alice ", "ACTIVE"
        );

        assertThat(response.items()).extracting(ManagementCreditWalletPageResponse.WalletItem::userId)
                .containsExactly(first.userId(), second.userId());
        assertThat(response.nextCursor()).isNotBlank();
        verify(repository).findWallets("alice", "active", null, null, 3);

        when(repository.findWallets("alice", "active", second.updatedAt(), second.userId(), 3))
                .thenReturn(List.of(lookahead));
        ManagementCreditWalletPageResponse next = service.wallets(
                context, response.nextCursor(), 2, "alice", "active"
        );
        assertThat(next.items()).hasSize(1);
        assertThat(next.nextCursor()).isNull();
    }

    @Test
    void ordersLedgerAndReservationAnomaliesMapReadOnlyRows() {
        SessionContext context = managementContext();
        CreditsManagementRepository.OrderRow order = orderRow();
        CreditsManagementRepository.LedgerRow ledger = ledgerRow();
        CreditsManagementRepository.ReservationAnomalyRow reservation = reservationRow();
        when(repository.findOrders(null, "manual_review", null, null, 21)).thenReturn(List.of(order));
        when(repository.findLedger(null, "recharge", null, null, 21)).thenReturn(List.of(ledger));
        when(repository.findReservationAnomalies(
                null, "expired", NOW, NOW.minusSeconds(7200), null, null, 21
        )).thenReturn(List.of(reservation));

        ManagementRechargeOrderPageResponse orders = service.orders(
                context, null, 20, null, "manual_review"
        );
        ManagementCreditLedgerPageResponse ledgerPage = service.ledger(
                context, null, 20, null, "recharge"
        );
        ManagementCreditReservationAnomalyPageResponse anomalies = service.reservationAnomalies(
                context, null, 20, null, "expired"
        );

        assertThat(orders.items().getFirst().orderNo()).isEqualTo(order.orderNo());
        assertThat(ledgerPage.items().getFirst().businessId()).isEqualTo(ledger.businessId());
        assertThat(anomalies.items().getFirst().anomalyType()).isEqualTo("expired");
    }

    @Test
    void wrongTerminalOrMissingPermissionCannotAuditCredits() {
        SessionContext desktop = context(ClientType.DESKTOP, Set.of("credits.manage"));
        SessionContext missingPermission = context(ClientType.MANAGEMENT_WEB, Set.of("tenant.read"));

        assertThatThrownBy(() -> service.wallets(desktop, null, 20, null, "all"))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDITS_MANAGEMENT_FORBIDDEN"));
        assertThatThrownBy(() -> service.wallets(missingPermission, null, 20, null, "all"))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDITS_MANAGEMENT_FORBIDDEN"));
    }

    @Test
    void invalidLimitsFiltersKeywordsAndCrossViewCursorsAreRejected() {
        SessionContext context = managementContext();
        when(repository.findWallets(null, null, null, null, 2))
                .thenReturn(List.of(
                        walletRow("00000000-0000-4000-8000-000000000002", "2026-08-25T11:02:00Z"),
                        walletRow("00000000-0000-4000-8000-000000000001", "2026-08-25T11:01:00Z")
                ));
        String walletCursor = service.wallets(context, null, 1, null, "all").nextCursor();

        assertThatThrownBy(() -> service.wallets(context, null, 101, null, "all"))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("INVALID_PAGE_REQUEST"));
        assertThatThrownBy(() -> service.orders(context, null, 20, null, "unknown"))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("INVALID_CREDIT_FILTER"));
        assertThatThrownBy(() -> service.ledger(context, null, 20, "x".repeat(121), "all"))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("INVALID_CREDIT_FILTER"));
        assertThatThrownBy(() -> service.orders(context, walletCursor, 20, null, "all"))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("INVALID_CREDITS_MANAGEMENT_CURSOR"));
    }

    @Test
    void unsafeCreditValuesAreRejectedBeforeTheyReachTheBrowser() {
        SessionContext context = managementContext();
        CreditsManagementRepository.WalletRow unsafe = new CreditsManagementRepository.WalletRow(
                UUID.randomUUID(), "unsafe", "unsafe@example.com", "active",
                9_007_199_254_740_992L, 0, NOW, NOW
        );
        when(repository.findWallets(null, null, null, null, 21)).thenReturn(List.of(unsafe));

        assertThatThrownBy(() -> service.wallets(context, null, 20, null, "all"))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(503);
                    assertThat(exception.code()).isEqualTo("CREDIT_VALUE_INVALID");
                });
    }

    private CreditsManagementRepository.WalletRow walletRow(String userId, String updatedAt) {
        return new CreditsManagementRepository.WalletRow(
                UUID.fromString(userId), "alice", "alice@example.com", "active",
                120, 10, Instant.parse("2026-08-25T10:00:00Z"), Instant.parse(updatedAt)
        );
    }

    private CreditsManagementRepository.OrderRow orderRow() {
        return new CreditsManagementRepository.OrderRow(
                UUID.randomUUID(), "LZ202608250001", UUID.randomUUID(), "alice", "alice@example.com",
                "starter", 990, 100, 10, "wechat", "manual_review",
                NOW.plusSeconds(900), null, null, NOW.minusSeconds(60), NOW
        );
    }

    private CreditsManagementRepository.LedgerRow ledgerRow() {
        return new CreditsManagementRepository.LedgerRow(
                UUID.randomUUID(), UUID.randomUUID(), "alice", "alice@example.com",
                UUID.randomUUID(), "Alice Tenant", "recharge", 100, 0, 100, 0,
                "recharge_order", "LZ202608250001", null, NOW
        );
    }

    private CreditsManagementRepository.ReservationAnomalyRow reservationRow() {
        return new CreditsManagementRepository.ReservationAnomalyRow(
                UUID.randomUUID(), UUID.randomUUID(), "alice", "alice@example.com",
                UUID.randomUUID(), "Alice Tenant", "task-1", "attempt-1",
                20, 0, 0, "reserved", "expired", NOW.minusSeconds(60),
                NOW.minusSeconds(3600), NOW.minusSeconds(300)
        );
    }

    private SessionContext managementContext() {
        return context(ClientType.MANAGEMENT_WEB, Set.of("credits.manage"));
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(), UUID.randomUUID(), "credit_admin", "admin@example.com",
                UUID.randomUUID(), "credit_tenant", "Credit Tenant", UUID.randomUUID(),
                UUID.randomUUID(), clientType, "platform_admin", permissions, Map.of(),
                NOW.plusSeconds(900)
        );
    }
}
