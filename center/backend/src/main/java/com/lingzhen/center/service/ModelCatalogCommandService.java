package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelRequest;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelResponse;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelRequest;

import java.util.UUID;

public interface ModelCatalogCommandService {

    ModelProviderResponse createProvider(
            SessionContext sessionContext,
            CreateModelProviderRequest request
    );

    ModelProviderResponse updateProvider(
            SessionContext sessionContext,
            UUID providerId,
            UpdateModelProviderRequest request
    );

    ModelResponse createModel(SessionContext sessionContext, CreateModelRequest request);

    ModelResponse updateModel(
            SessionContext sessionContext,
            UUID modelId,
            UpdateModelRequest request
    );
}
