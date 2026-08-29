package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopBootstrapResponse;

public interface DesktopBootstrapService {

    DesktopBootstrapResponse load(SessionContext sessionContext);
}
