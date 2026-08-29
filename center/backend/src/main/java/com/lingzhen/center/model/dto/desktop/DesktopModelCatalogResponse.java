package com.lingzhen.center.model.dto.desktop;

import java.util.List;

public record DesktopModelCatalogResponse(
        DesktopBootstrapResponse.ModelCatalogSummary modelCatalog,
        List<DesktopBootstrapResponse.PlatformModelSummary> models
) {

    public DesktopModelCatalogResponse {
        models = List.copyOf(models);
    }
}
