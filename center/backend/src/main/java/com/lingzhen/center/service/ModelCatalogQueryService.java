package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionDetailResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderPageResponse;

import java.util.UUID;

public interface ModelCatalogQueryService {

    ModelProviderPageResponse providers(SessionContext sessionContext, int page, int pageSize);

    ModelPageResponse models(
            SessionContext sessionContext,
            int page,
            int pageSize,
            String keyword,
            String status,
            String capabilityType,
            UUID providerId
    );

    CatalogVersionPageResponse versions(SessionContext sessionContext, int page, int pageSize);

    CatalogVersionDetailResponse version(SessionContext sessionContext, UUID versionId);
}
