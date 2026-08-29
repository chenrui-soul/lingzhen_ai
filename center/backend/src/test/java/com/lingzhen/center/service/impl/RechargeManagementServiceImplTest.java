package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargePackageRequest;
import com.lingzhen.center.model.dto.billing.AdminCreditGrantRequest;
import com.lingzhen.center.model.dto.billing.ManualRechargeReviewRequest;
import com.lingzhen.center.model.dto.billing.SandboxPaymentSimulationRequest;
import com.lingzhen.center.model.dto.billing.UpdateRechargePackageRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.payment.SandboxPaymentAdapter;
import com.lingzhen.center.repository.RechargeRepository;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

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
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class RechargeManagementServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-26T02:00:00Z");

    private final RechargeRepository repository = mock(RechargeRepository.class);
    private final RechargeManagementServiceImpl service = new RechargeManagementServiceImpl(
            repository,
            new SandboxPaymentAdapter(),
            Clock.fixed(NOW, ZoneOffset.UTC)
    );

    @Test
    void createsDraftPackageWithNormalizedFieldsAndListsAllPackages() {
        RechargeRepository.PackageRow row = packageRow("starter_100", "Starter", "draft", 0);
        when(repository.createPackage(any())).thenReturn(Optional.of(row));
        when(repository.findPackages(false)).thenReturn(List.of(row));

        assertThat(service.createPackage(
                management(),
                new CreateRechargePackageRequest("Starter_100", " Starter ", 990, 100, 10, 20)
        ).status()).isEqualTo("draft");
        assertThat(service.packages(management()).items()).hasSize(1);

        ArgumentCaptor<RechargeRepository.PackageCreateCommand> captor =
                ArgumentCaptor.forClass(RechargeRepository.PackageCreateCommand.class);
        verify(repository).createPackage(captor.capture());
        assertThat(captor.getValue().code()).isEqualTo("starter_100");
        assertThat(captor.getValue().displayName()).isEqualTo("Starter");
        assertThat(captor.getValue().cashAmountCents()).isEqualTo(990);
        verify(repository).findPackages(false);
    }

    @Test
    void updatesPackageWithOptimisticLockAndRejectsStaleOrInvalidStatus() {
        UUID packageId = UUID.randomUUID();
        RechargeRepository.PackageRow current = packageRow(packageId, "starter_100", "Starter", "draft", 3);
        RechargeRepository.PackageRow updated = packageRow(packageId, "starter_100", "Starter Plus", "active", 4);
        when(repository.findPackage(packageId)).thenReturn(Optional.of(current));
        when(repository.updatePackage(any())).thenReturn(Optional.of(updated));

        assertThat(service.updatePackage(
                management(), packageId,
                new UpdateRechargePackageRequest(" Starter Plus ", 1290, 150, 20, " ACTIVE ", 10, 3L)
        ).rowVersion()).isEqualTo(4);

        ArgumentCaptor<RechargeRepository.PackageUpdateCommand> captor =
                ArgumentCaptor.forClass(RechargeRepository.PackageUpdateCommand.class);
        verify(repository).updatePackage(captor.capture());
        assertThat(captor.getValue().status()).isEqualTo("active");
        assertThat(captor.getValue().displayName()).isEqualTo("Starter Plus");

        assertThatThrownBy(() -> service.updatePackage(
                management(), packageId,
                new UpdateRechargePackageRequest("Stale", 990, 100, 0, "active", 10, 2L)
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("RECHARGE_PACKAGE_ROW_VERSION_CONFLICT"));

        assertThatThrownBy(() -> service.updatePackage(
                management(), packageId,
                new UpdateRechargePackageRequest("Invalid", 990, 100, 0, "removed", 10, 3L)
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("INVALID_RECHARGE_PACKAGE_STATUS"));
    }

    @Test
    void wrongTerminalOrMissingPermissionCannotManageRechargeBusiness() {
        SessionContext desktop = context(ClientType.DESKTOP, Set.of("credits.manage"));
        SessionContext missing = context(ClientType.MANAGEMENT_WEB, Set.of("credits.self.read"));

        assertThatThrownBy(() -> service.packages(desktop))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDITS_MANAGEMENT_FORBIDDEN"));
        assertThatThrownBy(() -> service.packages(missing))
                .isInstanceOfSatisfying(ApiException.class, exception ->
                        assertThat(exception.code()).isEqualTo("CREDITS_MANAGEMENT_FORBIDDEN"));
    }

    @Test
    void paidEventCreditsOnceAndReportsIdempotentReplay() {
        UUID orderId = UUID.randomUUID();
        RechargeRepository.OrderRow pending = orderRow(orderId, "pending", NOW.plusSeconds(900));
        RechargeRepository.OrderRow paid = orderRow(orderId, "paid", pending.expiresAt());
        when(repository.findOrder(orderId)).thenReturn(Optional.of(pending), Optional.of(paid));
        when(repository.applySandboxPayment(any())).thenReturn(
                new RechargeRepository.PaymentApplyResult("paid", true, 110, 0)
        );

        var response = service.simulateSandboxPayment(
                management(), orderId,
                new SandboxPaymentSimulationRequest("paid", "event-paid-0001", 990L)
        );

        assertThat(response.result()).isEqualTo("paid");
        assertThat(response.idempotentReplay()).isTrue();
        assertThat(response.availableBalance()).isEqualTo(110);
        assertThat(response.order().status()).isEqualTo("paid");
        verify(repository).applySandboxPayment(any());
    }

    @Test
    void amountMismatchIsRejectedBeforeWalletMutation() {
        UUID orderId = UUID.randomUUID();
        when(repository.findOrder(orderId)).thenReturn(Optional.of(
                orderRow(orderId, "pending", NOW.plusSeconds(900))
        ));

        assertThatThrownBy(() -> service.simulateSandboxPayment(
                management(), orderId,
                new SandboxPaymentSimulationRequest("paid", "event-paid-0002", 991L)
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("PAYMENT_AMOUNT_MISMATCH"));
        verify(repository, never()).applySandboxPayment(any());
    }

    @Test
    void failedAndCancelledEventsClosePendingOrdersWithoutCreditingWallet() {
        UUID failedOrderId = UUID.randomUUID();
        UUID cancelledOrderId = UUID.randomUUID();
        RechargeRepository.OrderRow failedPending = orderRow(failedOrderId, "pending", NOW.plusSeconds(900));
        RechargeRepository.OrderRow cancelledPending = orderRow(cancelledOrderId, "pending", NOW.plusSeconds(900));
        when(repository.findOrder(failedOrderId)).thenReturn(Optional.of(failedPending));
        when(repository.findOrder(cancelledOrderId)).thenReturn(Optional.of(cancelledPending));
        when(repository.closeOrder(failedOrderId, failedPending.userId(), NOW, false))
                .thenReturn(Optional.of(orderRow(failedOrderId, "closed", failedPending.expiresAt())));
        when(repository.closeOrder(cancelledOrderId, cancelledPending.userId(), NOW, false))
                .thenReturn(Optional.of(orderRow(cancelledOrderId, "closed", cancelledPending.expiresAt())));

        assertThat(service.simulateSandboxPayment(
                management(), failedOrderId,
                new SandboxPaymentSimulationRequest("failed", "event-failed-01", null)
        ).result()).isEqualTo("failed");
        assertThat(service.simulateSandboxPayment(
                management(), cancelledOrderId,
                new SandboxPaymentSimulationRequest("cancelled", "event-cancel-01", null)
        ).result()).isEqualTo("cancelled");
        verify(repository, never()).applySandboxPayment(any());
    }

    @Test
    void expiredPendingOrderIsClosedBeforePaymentEventIsApplied() {
        UUID orderId = UUID.randomUUID();
        RechargeRepository.OrderRow expired = orderRow(orderId, "pending", NOW.minusSeconds(1));
        RechargeRepository.OrderRow closed = orderRow(orderId, "closed", expired.expiresAt());
        when(repository.findOrder(orderId)).thenReturn(Optional.of(expired));
        when(repository.closeOrder(orderId, expired.userId(), NOW, true)).thenReturn(Optional.of(closed));

        var response = service.simulateSandboxPayment(
                management(), orderId,
                new SandboxPaymentSimulationRequest("paid", "event-expired-1", 990L)
        );

        assertThat(response.result()).isEqualTo("expired");
        assertThat(response.order().status()).isEqualTo("closed");
        verify(repository, never()).applySandboxPayment(any());
    }

    @Test
    void manualApprovalCreditsOnceAndReportsReplay() {
        UUID orderId = UUID.randomUUID();
        RechargeRepository.OrderRow review = manualOrderRow(orderId, "manual_review", null);
        RechargeRepository.OrderRow paid = manualOrderRow(orderId, "paid", "已核实到账");
        when(repository.findOrder(orderId)).thenReturn(Optional.of(review), Optional.of(paid));
        when(repository.approveManualRecharge(any())).thenReturn(
                new RechargeRepository.PaymentApplyResult("paid", true, 110, 0)
        );

        var response = service.approveManualRecharge(
                management(), orderId, new ManualRechargeReviewRequest("已核实到账")
        );

        assertThat(response.result()).isEqualTo("approved");
        assertThat(response.idempotentReplay()).isTrue();
        assertThat(response.availableBalance()).isEqualTo(110);
        verify(repository).approveManualRecharge(any());
    }

    @Test
    void manualRejectionDoesNotCreditWalletAndIsIdempotent() {
        UUID orderId = UUID.randomUUID();
        RechargeRepository.OrderRow review = manualOrderRow(orderId, "manual_review", null);
        RechargeRepository.OrderRow rejected = manualOrderRow(orderId, "rejected", "未查询到款项");
        when(repository.findOrder(orderId)).thenReturn(Optional.of(review), Optional.of(rejected));
        when(repository.rejectManualRecharge(any())).thenReturn(Optional.of(rejected));

        assertThat(service.rejectManualRecharge(
                management(), orderId, new ManualRechargeReviewRequest("未查询到款项")
        ).result()).isEqualTo("rejected");
        assertThat(service.rejectManualRecharge(
                management(), orderId, new ManualRechargeReviewRequest("未查询到款项")
        ).idempotentReplay()).isTrue();
        verify(repository, never()).applySandboxPayment(any());
    }

    @Test
    void adminGrantCreditsUsesTargetUserAndIdempotencyKey() {
        UUID targetUserId = UUID.randomUUID();
        when(repository.grantAdminCredits(any())).thenReturn(
                new RechargeRepository.PaymentApplyResult("granted", false, 420, 0)
        );

        var response = service.grantCredits(
                management(),
                new AdminCreditGrantRequest(targetUserId, 120, "测试补充", "grant-test-001")
        );

        assertThat(response.idempotentReplay()).isFalse();
        assertThat(response.availableBalance()).isEqualTo(420);
        ArgumentCaptor<RechargeRepository.ManualGrantCommand> captor =
                ArgumentCaptor.forClass(RechargeRepository.ManualGrantCommand.class);
        verify(repository).grantAdminCredits(captor.capture());
        assertThat(captor.getValue().targetUserId()).isEqualTo(targetUserId);
        assertThat(captor.getValue().credits()).isEqualTo(120);
        assertThat(captor.getValue().idempotencyKey()).isEqualTo("grant-test-001");
    }

    @Test
    void manualReviewRejectsSandboxOrderAndMissingManagementPermission() {
        UUID orderId = UUID.randomUUID();
        when(repository.findOrder(orderId)).thenReturn(Optional.of(
                orderRow(orderId, "pending", NOW.plusSeconds(900))
        ));
        assertThatThrownBy(() -> service.approveManualRecharge(
                management(), orderId, new ManualRechargeReviewRequest("已核实到账")
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("PAYMENT_CHANNEL_MISMATCH"));

        SessionContext desktop = context(ClientType.DESKTOP, Set.of("credits.manage"));
        assertThatThrownBy(() -> service.rejectManualRecharge(
                desktop, orderId, new ManualRechargeReviewRequest("无法核实")
        )).isInstanceOfSatisfying(ApiException.class, exception ->
                assertThat(exception.code()).isEqualTo("CREDITS_MANAGEMENT_FORBIDDEN"));
    }

    private RechargeRepository.PackageRow packageRow(
            String code,
            String displayName,
            String status,
            long rowVersion
    ) {
        return packageRow(UUID.randomUUID(), code, displayName, status, rowVersion);
    }

    private RechargeRepository.PackageRow packageRow(
            UUID packageId,
            String code,
            String displayName,
            String status,
            long rowVersion
    ) {
        return new RechargeRepository.PackageRow(
                packageId, code, displayName, 990, 100, 10,
                status, 10, NOW.minusSeconds(60), NOW, rowVersion
        );
    }

    private RechargeRepository.OrderRow orderRow(UUID orderId, String status, Instant expiresAt) {
        return new RechargeRepository.OrderRow(
                orderId, "LZ202608260001", UUID.randomUUID(), UUID.randomUUID(),
                "starter_100", 990, 100, 10, "sandbox", status,
                expiresAt, "paid".equals(status) ? NOW : null,
                "closed".equals(status) ? NOW : null,
                NOW.minusSeconds(60), NOW, "pending".equals(status) ? 0 : 1
        );
    }

    private RechargeRepository.OrderRow manualOrderRow(
            UUID orderId,
            String status,
            String reviewReason
    ) {
        return new RechargeRepository.OrderRow(
                orderId, "LZ202608260002", UUID.randomUUID(), UUID.randomUUID(),
                "starter_100", 990, 100, 10, "manual_transfer", status,
                NOW.plusSeconds(3600), "paid".equals(status) ? NOW : null,
                null, "用户已转账", reviewReason,
                reviewReason == null ? null : NOW, NOW.minusSeconds(60), NOW,
                "manual_review".equals(status) ? 0 : 1
        );
    }

    private SessionContext management() {
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
