package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopBootstrapResponse;
import com.lingzhen.center.model.dto.desktop.DesktopModelCatalogResponse;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceBootstrapData;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.DesktopBootstrapService;
import com.lingzhen.center.service.DesktopModelCatalogService;
import com.lingzhen.center.service.DesktopWorkspaceService;
import com.lingzhen.center.service.BillingWalletService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.util.OptionalLong;

@Service
public class DesktopBootstrapServiceImpl implements DesktopBootstrapService {

    private static final String BOOTSTRAP_PERMISSION = "desktop.bootstrap";

    private final DesktopModelCatalogService modelCatalogService;
    private final DesktopWorkspaceService workspaceService;
    private final BillingWalletService billingWalletService;
    private final Clock clock;

    public DesktopBootstrapServiceImpl(
            DesktopModelCatalogService modelCatalogService,
            DesktopWorkspaceService workspaceService,
            BillingWalletService billingWalletService,
            Clock clock
    ) {
        this.modelCatalogService = modelCatalogService;
        this.workspaceService = workspaceService;
        this.billingWalletService = billingWalletService;
        this.clock = clock;
    }

    @Override
    public DesktopBootstrapResponse load(SessionContext sessionContext) {
        if (sessionContext.clientType() != ClientType.DESKTOP
                || !sessionContext.permissions().contains(BOOTSTRAP_PERMISSION)) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "DESKTOP_BOOTSTRAP_FORBIDDEN",
                    "当前账号没有加载桌面工作台的权限"
            );
        }

        DesktopModelCatalogResponse catalog = modelCatalogService.loadForBootstrap(sessionContext);
        DesktopWorkspaceBootstrapData workspace = workspaceService.loadForBootstrap(sessionContext);
        OptionalLong availableBalance = billingWalletService.availableBalanceForBootstrap(sessionContext);
        return new DesktopBootstrapResponse(
                DesktopBootstrapResponse.SCHEMA_VERSION,
                clock.instant(),
                new DesktopBootstrapResponse.UserSummary(
                        sessionContext.userId(),
                        sessionContext.username(),
                        sessionContext.email()
                ),
                new DesktopBootstrapResponse.TenantSummary(
                        sessionContext.tenantId(),
                        sessionContext.tenantCode(),
                        sessionContext.tenantName()
                ),
                new DesktopBootstrapResponse.MembershipSummary(
                        sessionContext.membershipId(),
                        sessionContext.roleCode()
                ),
                sessionContext.permissions(),
                new DesktopBootstrapResponse.FeatureSummary(false),
                new DesktopBootstrapResponse.CreditSummary(
                        availableBalance.isPresent(),
                        availableBalance.orElse(0)
                ),
                catalog.modelCatalog(),
                catalog.models(),
                workspace.skills().stream().map(skill -> java.util.Map.<String, Object>of(
                        "code", skill.code(),
                        "displayName", skill.displayName(),
                        "version", skill.version(),
                        "description", skill.description() == null ? "" : skill.description()
                )).toList(),
                workspace.doubaoAccounts().stream().map(account ->
                        new DesktopBootstrapResponse.DoubaoAccountSummary(
                                account.accountId(), account.displayName(), account.loginState(),
                                account.loginSummary(), account.lastCheckedAt(), account.updatedAt()
                        )).toList(),
                workspace.recentProjects().stream().map(project ->
                        new DesktopBootstrapResponse.RecentProjectSummary(
                                project.id(), project.name(), project.updatedAt()
                        )).toList()
        );
    }
}
