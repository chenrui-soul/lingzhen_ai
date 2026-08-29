package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargeOrderRequest;
import com.lingzhen.center.model.dto.billing.RechargeOrderResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.RechargeRepository;
import org.junit.jupiter.api.Test;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RechargeServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-26T02:00:00Z");

    private final RechargeRepository repository = mock(RechargeRepository.class);
    private final RechargeServiceImpl service = new RechargeServiceImpl(
            repository,
            Clock.fixed(NOW, ZoneOffset.UTC)
    );

    @Test
    void listsOnlyActivePackagesForDesktopRechargePermission() {
        RechargeRepository.PackageRow row = packageRow();
        when(repository.findPackages(true)).thenReturn(List.of(row));

        assertThat(service.activePackages(desktop()).items())
                .extracting(item -> item.code())
                .containsExactly(row.code());
        verify(repository).findPackages(true);
    }

    @Test
    void repeatedIdempotencyKeyReturnsOriginalOrderButRejectsDifferentContent() {
        UUID packageId = UUID.randomUUID();
        RechargeRepository.OrderRow replay = orderRow(
                UUID.randomUUID(), packageId, "sandbox", "pending", NOW.plusSeconds(900)
        );
        when(repository.createOrder(any())).thenReturn(Optional.of(replay));

        RechargeOrderResponse response = service.createOrder(
                desktop(), "order-request-0001",
                new CreateRechargeOrderRequest(packageId, "sandbox")
        );
        assertThat(response.idempotentReplay()).isTrue();

        assertThatThrownBy(() -> service.createOrder(
                desktop(), "order-request-0001",
                new CreateRechargeOrderRequest(UUID.randomUUID(), "sandbox")
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("CREDIT_IDEMPOTENCY_CONFLICT"));
    }

    @Test
    void manualRechargeCreatesReviewOrderAndKeepsSubmissionNote() {
        UUID packageId = UUID.randomUUID();
        RechargeRepository.OrderRow created = manualOrderRow(
                UUID.randomUUID(), packageId, UUID.randomUUID(), "manual_review"
        );
        when(repository.createManualOrder(any())).thenReturn(Optional.of(created));

        RechargeOrderResponse response = service.createOrder(
                desktop(created.userId()),
                "manual-request-0001",
                new CreateRechargeOrderRequest(packageId, "manual_transfer", " 已完成线下转账 ")
        );

        assertThat(response.status()).isEqualTo("manual_review");
        assertThat(response.paymentChannel()).isEqualTo("manual_transfer");
        assertThat(response.submissionNote()).isEqualTo("已完成线下转账");
        verify(repository).createManualOrder(any());
    }

    @Test
    void listsAndCancelsOnlyCurrentUsersManualOrders() {
        UUID userId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        RechargeRepository.OrderRow review = manualOrderRow(
                orderId, UUID.randomUUID(), userId, "manual_review"
        );
        RechargeRepository.OrderRow closed = manualOrderRow(
                orderId, review.packageId(), userId, "closed"
        );
        when(repository.findUserOrders(userId, 20)).thenReturn(List.of(review));
        when(repository.findUserOrder(userId, orderId)).thenReturn(Optional.of(review));
        when(repository.cancelManualOrder(orderId, userId, NOW)).thenReturn(Optional.of(closed));

        assertThat(service.orders(desktop(userId), 20).items())
                .extracting(RechargeOrderResponse::id)
                .containsExactly(orderId);
        assertThat(service.cancelOrder(desktop(userId), orderId).status()).isEqualTo("closed");
        verify(repository).findUserOrders(userId, 20);
        verify(repository).cancelManualOrder(orderId, userId, NOW);
    }

    @Test
    void paidOrSandboxOrderCannotBeCancelledAsManualApplication() {
        UUID userId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        when(repository.findUserOrder(userId, orderId)).thenReturn(Optional.of(
                orderRow(orderId, UUID.randomUUID(), "sandbox", "pending", NOW.plusSeconds(900))
        ));

        assertThatThrownBy(() -> service.cancelOrder(desktop(userId), orderId))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("RECHARGE_ORDER_STATE_CONFLICT"));
    }

    @Test
    void expiredOrderIsClosedWhenOwnerQueriesIt() {
        UUID userId = UUID.randomUUID();
        UUID orderId = UUID.randomUUID();
        SessionContext context = desktop(userId);
        RechargeRepository.OrderRow expired = orderRow(
                orderId, UUID.randomUUID(), "sandbox", "pending", NOW.minusSeconds(1)
        );
        RechargeRepository.OrderRow closed = orderRow(
                orderId, expired.packageId(), "sandbox", "closed", expired.expiresAt()
        );
        when(repository.findUserOrder(userId, orderId)).thenReturn(Optional.of(expired));
        when(repository.closeOrder(orderId, expired.userId(), NOW, true)).thenReturn(Optional.of(closed));

        assertThat(service.order(context, orderId).status()).isEqualTo("closed");
        verify(repository).closeOrder(orderId, expired.userId(), NOW, true);
    }

    @Test
    void wrongTerminalOrMissingPermissionCannotRecharge() {
        SessionContext management = context(ClientType.MANAGEMENT_WEB, Set.of("credits.self.recharge"));
        SessionContext missing = context(ClientType.DESKTOP, Set.of("credits.self.read"));

        assertThatThrownBy(() -> service.activePackages(management))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDIT_RECHARGE_FORBIDDEN"));
        assertThatThrownBy(() -> service.activePackages(missing))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDIT_RECHARGE_FORBIDDEN"));
    }

    private RechargeRepository.PackageRow packageRow() {
        return new RechargeRepository.PackageRow(
                UUID.randomUUID(), "starter_100", "Starter", 990, 100, 10,
                "active", 10, NOW.minusSeconds(60), NOW, 1
        );
    }

    private RechargeRepository.OrderRow orderRow(
            UUID orderId,
            UUID packageId,
            String channel,
            String status,
            Instant expiresAt
    ) {
        return new RechargeRepository.OrderRow(
                orderId, "LZ202608260001", UUID.randomUUID(), packageId,
                "starter_100", 990, 100, 10, channel, status,
                expiresAt, null, "closed".equals(status) ? NOW : null,
                NOW.minusSeconds(60), NOW, 0
        );
    }

    private RechargeRepository.OrderRow manualOrderRow(
            UUID orderId,
            UUID packageId,
            UUID userId,
            String status
    ) {
        return new RechargeRepository.OrderRow(
                orderId, "LZ202608260002", userId, packageId,
                "starter_100", 990, 100, 10, "manual_transfer", status,
                NOW.plusSeconds(3600), null, "closed".equals(status) ? NOW : null,
                "已完成线下转账", null, null, NOW.minusSeconds(60), NOW, 0
        );
    }

    private SessionContext desktop() {
        return desktop(UUID.randomUUID());
    }

    private SessionContext desktop(UUID userId) {
        return context(userId, ClientType.DESKTOP, Set.of("credits.self.recharge"));
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return context(UUID.randomUUID(), clientType, permissions);
    }

    private SessionContext context(UUID userId, ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(), userId, "recharge_user", "recharge@example.com",
                UUID.randomUUID(), "tenant", "Tenant", UUID.randomUUID(), UUID.randomUUID(),
                clientType, "tenant_member", permissions, Map.of(), NOW.plusSeconds(900)
        );
    }
}
