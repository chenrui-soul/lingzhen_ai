package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelListResponse;

public interface TenantModelQueryService {

    TenantModelListResponse models(SessionContext sessionContext);
}
