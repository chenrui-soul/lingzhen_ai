package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.management.ManagementDashboardResponse;
import com.lingzhen.center.model.dto.management.ManagementTenantResponse;
import com.lingzhen.center.model.dto.management.ManagementUserPageResponse;

public interface ManagementReadService {

    ManagementDashboardResponse dashboard(SessionContext sessionContext);

    ManagementUserPageResponse users(
            SessionContext sessionContext,
            int page,
            int pageSize,
            String keyword,
            String status
    );

    ManagementTenantResponse tenant(SessionContext sessionContext);
}
