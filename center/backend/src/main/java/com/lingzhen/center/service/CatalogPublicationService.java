package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishPreviewResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishResponse;
import com.lingzhen.center.model.dto.modelcatalog.PublishCatalogRequest;

public interface CatalogPublicationService {

    CatalogPublishPreviewResponse preview(SessionContext sessionContext);

    CatalogPublishResponse publish(
            SessionContext sessionContext,
            String idempotencyKey,
            PublishCatalogRequest request
    );
}
