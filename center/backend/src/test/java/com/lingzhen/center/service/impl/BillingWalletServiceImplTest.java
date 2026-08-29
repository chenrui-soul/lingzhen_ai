package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.CreditWalletResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.BillingWalletRepository;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessResourceFailureException;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class BillingWalletServiceImplTest {

    private final BillingWalletRepository repository = mock(BillingWalletRepository.class);
    private final BillingWalletServiceImpl service = new BillingWalletServiceImpl(repository);

    @Test
    void walletReturnsOnlyTheCurrentUsersGlobalBalance() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("credits.self.read"));
        Instant updatedAt = Instant.parse("2026-08-25T12:00:00Z");
        when(repository.findWallet(context.userId())).thenReturn(Optional.of(
                new BillingWalletRepository.WalletRow(context.userId(), 125, 20, updatedAt, 3)
        ));

        CreditWalletResponse response = service.wallet(context);

        assertThat(response.userId()).isEqualTo(context.userId());
        assertThat(response.availableBalance()).isEqualTo(125);
        assertThat(response.reservedBalance()).isEqualTo(20);
        assertThat(response.updatedAt()).isEqualTo(updatedAt);
        verify(repository).findWallet(context.userId());
    }

    @Test
    void ledgerUsesStableCursorAndDoesNotExposeTheLookaheadRow() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("credits.self.read"));
        BillingWalletRepository.LedgerRow newest = ledgerRow("00000000-0000-4000-8000-000000000003", "2026-08-25T12:03:00Z");
        BillingWalletRepository.LedgerRow second = ledgerRow("00000000-0000-4000-8000-000000000002", "2026-08-25T12:02:00Z");
        BillingWalletRepository.LedgerRow lookahead = ledgerRow("00000000-0000-4000-8000-000000000001", "2026-08-25T12:01:00Z");
        when(repository.findLedger(context.userId(), null, null, 3))
                .thenReturn(List.of(newest, second, lookahead));

        CreditLedgerPageResponse firstPage = service.ledger(context, null, 2);

        assertThat(firstPage.items()).extracting(CreditLedgerPageResponse.LedgerItem::id)
                .containsExactly(newest.id(), second.id());
        assertThat(firstPage.nextCursor()).isNotBlank();
        when(repository.findLedger(context.userId(), second.createdAt(), second.id(), 3))
                .thenReturn(List.of(lookahead));

        CreditLedgerPageResponse secondPage = service.ledger(context, firstPage.nextCursor(), 2);

        assertThat(secondPage.items()).extracting(CreditLedgerPageResponse.LedgerItem::id)
                .containsExactly(lookahead.id());
        assertThat(secondPage.nextCursor()).isNull();
        verify(repository).findLedger(context.userId(), second.createdAt(), second.id(), 3);
    }

    @Test
    void invalidCursorAndPageSizeAreRejected() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("credits.self.read"));

        assertThatThrownBy(() -> service.ledger(context, "not-a-cursor", 20))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(400);
                    assertThat(exception.code()).isEqualTo("INVALID_CREDIT_LEDGER_CURSOR");
                });
        assertThatThrownBy(() -> service.ledger(context, null, 101))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("INVALID_PAGE_REQUEST"));
    }

    @Test
    void wrongTerminalOrMissingPermissionCannotReadWallet() {
        SessionContext management = context(ClientType.MANAGEMENT_WEB, Set.of("credits.self.read"));
        SessionContext missingPermission = context(ClientType.DESKTOP, Set.of("desktop.bootstrap"));

        assertThatThrownBy(() -> service.wallet(management))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDIT_WALLET_READ_FORBIDDEN"));
        assertThatThrownBy(() -> service.wallet(missingPermission))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDIT_WALLET_READ_FORBIDDEN"));
    }

    @Test
    void bootstrapDegradesOnlyCreditsWhenBillingIsUnavailable() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("credits.self.read"));
        when(repository.findWallet(context.userId()))
                .thenThrow(new DataAccessResourceFailureException("billing unavailable"));

        assertThat(service.availableBalanceForBootstrap(context)).isEmpty();
    }

    @Test
    void unsafeJavascriptBalanceIsRejected() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("credits.self.read"));
        when(repository.findWallet(context.userId())).thenReturn(Optional.of(
                new BillingWalletRepository.WalletRow(
                        context.userId(), 9_007_199_254_740_992L, 0, Instant.now(), 0
                )
        ));

        assertThatThrownBy(() -> service.wallet(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(503);
                    assertThat(exception.code()).isEqualTo("CREDIT_VALUE_INVALID");
                });
    }

    @Test
    void bootstrapDoesNotHideAnUnsafeOnlineBalanceAsUnavailable() {
        SessionContext context = context(ClientType.DESKTOP, Set.of("credits.self.read"));
        when(repository.findWallet(context.userId())).thenReturn(Optional.of(
                new BillingWalletRepository.WalletRow(
                        context.userId(), 9_007_199_254_740_992L, 0, Instant.now(), 0
                )
        ));

        assertThatThrownBy(() -> service.availableBalanceForBootstrap(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(503);
                    assertThat(exception.code()).isEqualTo("CREDIT_VALUE_INVALID");
                });
    }

    private BillingWalletRepository.LedgerRow ledgerRow(String id, String createdAt) {
        return new BillingWalletRepository.LedgerRow(
                UUID.fromString(id),
                UUID.randomUUID(),
                "recharge",
                10,
                0,
                10,
                0,
                "test",
                id,
                null,
                Instant.parse(createdAt)
        );
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "wallet_user",
                "wallet@example.com",
                UUID.randomUUID(),
                "wallet_tenant",
                "Wallet Tenant",
                UUID.randomUUID(),
                UUID.randomUUID(),
                clientType,
                "member",
                permissions,
                Map.of(),
                Instant.now().plusSeconds(900)
        );
    }
}
