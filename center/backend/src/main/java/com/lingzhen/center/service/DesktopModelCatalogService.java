package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopModelCatalogResponse;

public interface DesktopModelCatalogService {

    DesktopModelCatalogResponse load(SessionContext sessionContext);

    DesktopModelCatalogResponse loadForBootstrap(SessionContext sessionContext);
}
