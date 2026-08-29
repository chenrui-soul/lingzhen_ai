package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelPolicyResponse;
import com.lingzhen.center.model.dto.modelcatalog.UpdateTenantModelPolicyRequest;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.TenantModelRepository;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TenantModelCommandServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T06:00:00Z");

    private final TenantModelRepository repository = mock(TenantModelRepository.class);
    private final TenantModelCommandServiceImpl service =
            new TenantModelCommandServiceImpl(repository);

    @Test
    void createsTheFirstExplicitPolicyForTheCurrentTenant() {
        SessionContext context = context(Set.of("tenant_model.manage"));
        UUID modelId = UUID.randomUUID();
        when(repository.findCurrentModelDefault(modelId)).thenReturn(Optional.of(false));
        when(repository.findPolicy(context.tenantId(), modelId)).thenReturn(Optional.empty());
        when(repository.createPolicy(argThat(command ->
                command.tenantId().equals(context.tenantId())
                        && command.modelId().equals(modelId)
                        && command.policy().equals("enabled")
                        && command.updatedByMembershipId().equals(context.membershipId())
        ))).thenReturn(policyRow(context, modelId, "enabled", 0));

        TenantModelPolicyResponse response = service.updatePolicy(
                context,
                modelId,
                new UpdateTenantModelPolicyRequest("enabled", null)
        );

        assertThat(response.policy()).isEqualTo("enabled");
        assertThat(response.effectiveEnabled()).isTrue();
        assertThat(response.rowVersion()).isZero();
    }

    @Test
    void updatesAnExistingPolicyWithAnAtomicRowVersion() {
        SessionContext context = context(Set.of("tenant_model.manage"));
        UUID modelId = UUID.randomUUID();
        TenantModelRepository.PolicyRow current = policyRow(context, modelId, "enabled", 2);
        when(repository.findCurrentModelDefault(modelId)).thenReturn(Optional.of(true));
        when(repository.findPolicy(context.tenantId(), modelId)).thenReturn(Optional.of(current));
        when(repository.updatePolicy(argThat(command ->
                command.id().equals(current.id())
                        && command.policy().equals("hidden")
                        && command.rowVersion() == 2
        ))).thenReturn(Optional.of(policyRow(context, modelId, "hidden", 3)));

        TenantModelPolicyResponse response = service.updatePolicy(
                context,
                modelId,
                new UpdateTenantModelPolicyRequest("hidden", 2L)
        );

        assertThat(response.policy()).isEqualTo("hidden");
        assertThat(response.effectiveEnabled()).isFalse();
        assertThat(response.rowVersion()).isEqualTo(3);
    }

    @Test
    void returnsVirtualInheritanceWithoutCreatingAnUnnecessaryRow() {
        SessionContext context = context(Set.of("tenant_model.manage"));
        UUID modelId = UUID.randomUUID();
        when(repository.findCurrentModelDefault(modelId)).thenReturn(Optional.of(true));
        when(repository.findPolicy(context.tenantId(), modelId)).thenReturn(Optional.empty());

        TenantModelPolicyResponse response = service.updatePolicy(
                context,
                modelId,
                new UpdateTenantModelPolicyRequest("inherit", null)
        );

        assertThat(response.policyId()).isNull();
        assertThat(response.policy()).isEqualTo("inherit");
        assertThat(response.effectiveEnabled()).isTrue();
        assertThat(response.rowVersion()).isNull();
        verify(repository, never()).createPolicy(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void rejectsAStalePolicyVersion() {
        SessionContext context = context(Set.of("tenant_model.manage"));
        UUID modelId = UUID.randomUUID();
        when(repository.findCurrentModelDefault(modelId)).thenReturn(Optional.of(true));
        when(repository.findPolicy(context.tenantId(), modelId))
                .thenReturn(Optional.of(policyRow(context, modelId, "enabled", 4)));

        assertThatThrownBy(() -> service.updatePolicy(
                context,
                modelId,
                new UpdateTenantModelPolicyRequest("hidden", 3L)
        )).isInstanceOfSatisfying(ApiException.class, exception -> {
            assertThat(exception.status().value()).isEqualTo(409);
            assertThat(exception.code()).isEqualTo("TENANT_MODEL_ROW_VERSION_CONFLICT");
        });

        verify(repository, never()).updatePolicy(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void rejectsModelsOutsideTheCurrentPublishedCatalog() {
        SessionContext context = context(Set.of("tenant_model.manage"));
        UUID modelId = UUID.randomUUID();
        when(repository.findCurrentModelDefault(modelId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> service.updatePolicy(
                context,
                modelId,
                new UpdateTenantModelPolicyRequest("enabled", null)
        )).isInstanceOfSatisfying(ApiException.class, exception -> {
            assertThat(exception.status().value()).isEqualTo(404);
            assertThat(exception.code()).isEqualTo("TENANT_MODEL_NOT_IN_CURRENT_CATALOG");
        });

        verify(repository, never()).findPolicy(context.tenantId(), modelId);
    }

    @Test
    void rejectsDesktopSessionsBeforeRepositoryAccess() {
        SessionContext context = new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "desktop_user",
                "desktop@example.com",
                UUID.randomUUID(),
                "tenant_alpha",
                "Alpha 工作空间",
                UUID.randomUUID(),
                UUID.randomUUID(),
                ClientType.DESKTOP,
                "owner",
                Set.of("tenant_model.manage"),
                Map.of(),
                NOW.plusSeconds(900)
        );

        assertThatThrownBy(() -> service.updatePolicy(
                context,
                UUID.randomUUID(),
                new UpdateTenantModelPolicyRequest("enabled", null)
        )).isInstanceOfSatisfying(ApiException.class, exception -> {
            assertThat(exception.status().value()).isEqualTo(403);
            assertThat(exception.code()).isEqualTo("TENANT_MODEL_MANAGE_FORBIDDEN");
        });

        verify(repository, never()).findCurrentModelDefault(org.mockito.ArgumentMatchers.any());
    }

    private SessionContext context(Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "tenant_admin",
                "tenant@example.com",
                UUID.randomUUID(),
                "tenant_alpha",
                "Alpha 工作空间",
                UUID.randomUUID(),
                UUID.randomUUID(),
                ClientType.MANAGEMENT_WEB,
                "owner",
                permissions,
                Map.of(),
                NOW.plusSeconds(900)
        );
    }

    private TenantModelRepository.PolicyRow policyRow(
            SessionContext context,
            UUID modelId,
            String policy,
            long rowVersion
    ) {
        return new TenantModelRepository.PolicyRow(
                UUID.randomUUID(),
                context.tenantId(),
                modelId,
                policy,
                context.membershipId(),
                NOW,
                NOW,
                rowVersion
        );
    }
}
