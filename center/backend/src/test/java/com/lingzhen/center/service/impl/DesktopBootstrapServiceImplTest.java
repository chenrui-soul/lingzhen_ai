package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopBootstrapResponse;
import com.lingzhen.center.model.dto.desktop.DesktopModelCatalogResponse;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceBootstrapData;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.DesktopModelCatalogService;
import com.lingzhen.center.service.DesktopWorkspaceService;
import com.lingzhen.center.service.BillingWalletService;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.OptionalLong;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DesktopBootstrapServiceImplTest {

    private static final Instant NOW = Instant.parse("2026-08-25T05:00:00Z");

    private final DesktopModelCatalogService modelCatalogService = mock(DesktopModelCatalogService.class);
    private final DesktopWorkspaceService workspaceService = mock(DesktopWorkspaceService.class);
    private final BillingWalletService billingWalletService = mock(BillingWalletService.class);
    private final DesktopBootstrapServiceImpl service = new DesktopBootstrapServiceImpl(
            modelCatalogService,
            workspaceService,
            billingWalletService,
            Clock.fixed(NOW, ZoneOffset.UTC)
    );

    @Test
    void loadReturnsStableFirstVersionWorkspaceContract() {
        SessionContext context = context(
                ClientType.DESKTOP,
                Set.of("desktop.bootstrap", "creation.use")
        );
        when(modelCatalogService.loadForBootstrap(context)).thenReturn(unavailableCatalog());
        when(workspaceService.loadForBootstrap(context)).thenReturn(emptyWorkspace());

        DesktopBootstrapResponse response = service.load(context);

        assertThat(response.schemaVersion()).isEqualTo(1);
        assertThat(response.generatedAt()).isEqualTo(NOW);
        assertThat(response.user().id()).isEqualTo(context.userId());
        assertThat(response.tenant().id()).isEqualTo(context.tenantId());
        assertThat(response.membership().id()).isEqualTo(context.membershipId());
        assertThat(response.membership().role()).isEqualTo("member");
        assertThat(response.permissions()).contains("desktop.bootstrap", "creation.use");
        assertThat(response.features().infiniteCanvas()).isFalse();
        assertThat(response.credits().available()).isFalse();
        assertThat(response.credits().balance()).isZero();
        assertThat(response.modelCatalog().available()).isFalse();
        assertThat(response.modelCatalog().version()).isNull();
        assertThat(response.models()).isEmpty();
        assertThat(response.skills()).isEmpty();
        assertThat(response.doubaoAccounts()).isEmpty();
        assertThat(response.recentProjects()).isEmpty();
        verify(modelCatalogService).loadForBootstrap(context);
        verify(workspaceService).loadForBootstrap(context);
    }

    @Test
    void loadIncludesTheSamePlatformCatalogReturnedByCatalogService() {
        SessionContext context = context(
                ClientType.DESKTOP,
                Set.of("desktop.bootstrap")
        );
        DesktopBootstrapResponse.PlatformModelSummary model = platformModel(
                Map.of("type", "object"),
                false
        );
        when(modelCatalogService.loadForBootstrap(context)).thenReturn(
                new DesktopModelCatalogResponse(
                        new DesktopBootstrapResponse.ModelCatalogSummary(
                                true,
                                7L,
                                Instant.parse("2026-08-25T04:00:00Z")
                        ),
                        List.of(model)
                )
        );
        when(workspaceService.loadForBootstrap(context)).thenReturn(emptyWorkspace());

        DesktopBootstrapResponse response = service.load(context);

        assertThat(response.modelCatalog().version()).isEqualTo(7L);
        assertThat(response.models()).containsExactly(model);
    }

    @Test
    void loadUsesGlobalWalletBalanceWithoutChangingSchemaVersion() {
        SessionContext context = context(
                ClientType.DESKTOP,
                Set.of("desktop.bootstrap", "credits.self.read")
        );
        when(modelCatalogService.loadForBootstrap(context)).thenReturn(unavailableCatalog());
        when(workspaceService.loadForBootstrap(context)).thenReturn(emptyWorkspace());
        when(billingWalletService.availableBalanceForBootstrap(context)).thenReturn(OptionalLong.of(125));

        DesktopBootstrapResponse response = service.load(context);

        assertThat(response.schemaVersion()).isEqualTo(1);
        assertThat(response.credits().available()).isTrue();
        assertThat(response.credits().balance()).isEqualTo(125);
        verify(billingWalletService).availableBalanceForBootstrap(context);
    }

    @Test
    void platformModelContractAllowsOnlyPublicWaveThreeFields() {
        DesktopBootstrapResponse.PlatformModelSummary model = platformModel(
                Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "duration", Map.of("type", "integer", "enum", List.of(5, 10)),
                                "aspectRatio", Map.of("type", "string")
                        )
                ),
                false
        );
        DesktopBootstrapResponse response = responseWith(model);

        assertThat(response.schemaVersion()).isEqualTo(DesktopBootstrapResponse.SCHEMA_VERSION);
        assertThat(response.modelCatalog().version()).isEqualTo(7L);
        assertThat(response.models()).singleElement().satisfies(item -> {
            assertThat(item.source()).isEqualTo("platform");
            assertThat(item.capabilityType()).isEqualTo("video");
            assertThat(item.executionReady()).isFalse();
            assertThat(item.parameterSchema()).containsKey("properties");
        });
    }

    @Test
    void serializedPlatformModelContractRemainsCompatibleWithDesktopSchemaOne() throws Exception {
        DesktopBootstrapResponse response = responseWith(platformModel(
                Map.of("type", "object", "properties", Map.of()),
                false
        ));

        String json = new ObjectMapper().writeValueAsString(response);

        assertThat(json)
                .contains("\"schemaVersion\":1")
                .contains("\"modelCatalog\":")
                .contains("\"source\":\"platform\"")
                .contains("\"capabilityType\":\"video\"")
                .contains("\"executionReady\":false");
        assertThat(json)
                .doesNotContain("\"apiKey\"")
                .doesNotContain("\"credentialRef\"")
                .doesNotContain("\"baseUrl\"")
                .doesNotContain("\"privateHeaders\"")
                .doesNotContain("\"secret\"");
    }

    @Test
    void platformModelContractRejectsSensitiveNestedFields() {
        assertThatThrownBy(() -> platformModel(
                Map.of(
                        "type", "object",
                        "properties", Map.of(
                                "apiKey", Map.of("type", "string")
                        )
                ),
                false
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("apiKey");
    }

    @Test
    void platformModelContractRejectsPrototypePollutionKeys() {
        assertThatThrownBy(() -> platformModel(
                Map.of("type", "object", "properties", Map.of("__proto__", Map.of("type", "string"))),
                false
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("__proto__");
    }

    @Test
    void platformModelContractRejectsDesktopIncompatibleNestingDepth() {
        Map<String, Object> nested = Map.of("type", "string");
        for (int index = 0; index < 13; index++) {
            nested = Map.of("level" + index, nested);
        }
        Map<String, Object> tooDeep = nested;

        assertThatThrownBy(() -> platformModel(tooDeep, false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("deeply nested");
    }

    @Test
    void platformModelContractRejectsDesktopIncompatibleCollectionSizes() {
        LinkedHashMap<String, Object> tooManyProperties = new LinkedHashMap<>();
        for (int index = 0; index < 201; index++) {
            tooManyProperties.put("field" + index, Map.of("type", "string"));
        }

        assertThatThrownBy(() -> platformModel(Map.of("properties", tooManyProperties), false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("object is too large");
        assertThatThrownBy(() -> platformModel(Map.of("enum", Collections.nCopies(1001, "value")), false))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("array is too large");
    }

    @Test
    void platformModelContractAllowsExecutionWhenBackendProxyIsAvailable() {
        assertThat(platformModel(Map.of("type", "object"), true).executionReady()).isTrue();
    }

    @Test
    void bootstrapContractRejectsSchemaVersionChanges() {
        assertThatThrownBy(() -> new DesktopBootstrapResponse(
                2,
                Instant.now(),
                new DesktopBootstrapResponse.UserSummary(UUID.randomUUID(), "user", "user@example.com"),
                new DesktopBootstrapResponse.TenantSummary(UUID.randomUUID(), "tenant", "Tenant"),
                new DesktopBootstrapResponse.MembershipSummary(UUID.randomUUID(), "member"),
                Set.of("desktop.bootstrap"),
                new DesktopBootstrapResponse.FeatureSummary(false),
                new DesktopBootstrapResponse.CreditSummary(false, 0),
                new DesktopBootstrapResponse.ModelCatalogSummary(false, null, null),
                List.of(),
                List.of()
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("schemaVersion");
    }

    @Test
    void bootstrapContractRejectsAvailableCatalogWithoutPublicationTime() {
        assertThatThrownBy(() -> new DesktopBootstrapResponse.ModelCatalogSummary(true, 7L, null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("publishedAt");
    }

    @Test
    void bootstrapContractRejectsMoreModelsThanDesktopCanCache() {
        DesktopBootstrapResponse.PlatformModelSummary model = platformModel(Map.of("type", "object"), false);

        assertThatThrownBy(() -> new DesktopBootstrapResponse(
                DesktopBootstrapResponse.SCHEMA_VERSION,
                Instant.now(),
                new DesktopBootstrapResponse.UserSummary(UUID.randomUUID(), "user", "user@example.com"),
                new DesktopBootstrapResponse.TenantSummary(UUID.randomUUID(), "tenant", "Tenant"),
                new DesktopBootstrapResponse.MembershipSummary(UUID.randomUUID(), "member"),
                Set.of("desktop.bootstrap", "model.use"),
                new DesktopBootstrapResponse.FeatureSummary(false),
                new DesktopBootstrapResponse.CreditSummary(false, 0),
                new DesktopBootstrapResponse.ModelCatalogSummary(true, 7L, Instant.now()),
                Collections.nCopies(501, model),
                List.of()
        ))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("model limit");
    }

    @Test
    void loadRejectsNonDesktopSession() {
        SessionContext context = context(
                ClientType.MANAGEMENT_WEB,
                Set.of("desktop.bootstrap")
        );

        assertThatThrownBy(() -> service.load(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(403);
                    assertThat(exception.code()).isEqualTo("DESKTOP_BOOTSTRAP_FORBIDDEN");
                });

        verify(modelCatalogService, never()).loadForBootstrap(context);
    }

    @Test
    void loadRejectsDesktopSessionWithoutBootstrapPermission() {
        SessionContext context = context(
                ClientType.DESKTOP,
                Set.of("creation.use")
        );

        assertThatThrownBy(() -> service.load(context))
                .isInstanceOfSatisfying(ApiException.class, exception -> {
                    assertThat(exception.status().value()).isEqualTo(403);
                    assertThat(exception.code()).isEqualTo("DESKTOP_BOOTSTRAP_FORBIDDEN");
                });

        verify(modelCatalogService, never()).loadForBootstrap(context);
    }

    private SessionContext context(ClientType clientType, Set<String> permissions) {
        return new SessionContext(
                UUID.randomUUID(),
                UUID.randomUUID(),
                "bootstrap_user",
                "bootstrap@example.com",
                UUID.randomUUID(),
                "bootstrap_tenant",
                "Bootstrap Tenant",
                UUID.randomUUID(),
                UUID.randomUUID(),
                clientType,
                "member",
                permissions,
                Map.of(),
                Instant.now().plusSeconds(900)
        );
    }

    private DesktopBootstrapResponse.PlatformModelSummary platformModel(
            Map<String, Object> parameterSchema,
            boolean executionReady
    ) {
        return new DesktopBootstrapResponse.PlatformModelSummary(
                UUID.fromString("77777777-7777-4777-8777-777777777777"),
                "platform",
                new DesktopBootstrapResponse.PlatformProviderSummary(
                        UUID.fromString("88888888-8888-4888-8888-888888888888"),
                        "lingzhen",
                        "灵帧平台"
                ),
                "seedance-video",
                "视频模型",
                "video",
                parameterSchema,
                Map.of("duration", 10, "aspectRatio", "16:9"),
                7,
                executionReady
        );
    }

    private DesktopBootstrapResponse responseWith(
            DesktopBootstrapResponse.PlatformModelSummary model
    ) {
        return new DesktopBootstrapResponse(
                DesktopBootstrapResponse.SCHEMA_VERSION,
                Instant.now(),
                new DesktopBootstrapResponse.UserSummary(UUID.randomUUID(), "user", "user@example.com"),
                new DesktopBootstrapResponse.TenantSummary(UUID.randomUUID(), "tenant", "Tenant"),
                new DesktopBootstrapResponse.MembershipSummary(UUID.randomUUID(), "member"),
                Set.of("desktop.bootstrap", "model.use"),
                new DesktopBootstrapResponse.FeatureSummary(false),
                new DesktopBootstrapResponse.CreditSummary(false, 0),
                new DesktopBootstrapResponse.ModelCatalogSummary(true, 7L, Instant.now()),
                List.of(model),
                List.of()
        );
    }

    private DesktopModelCatalogResponse unavailableCatalog() {
        return new DesktopModelCatalogResponse(
                new DesktopBootstrapResponse.ModelCatalogSummary(false, null, null),
                List.of()
        );
    }

    private DesktopWorkspaceBootstrapData emptyWorkspace() {
        return new DesktopWorkspaceBootstrapData(List.of(), List.of(), List.of());
    }
}
