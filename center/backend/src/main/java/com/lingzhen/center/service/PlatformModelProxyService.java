package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskRequest;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskResponse;

import java.util.UUID;
import java.util.List;

public interface PlatformModelProxyService {
    PlatformModelTaskResponse submit(SessionContext sessionContext, PlatformModelTaskRequest request);
    PlatformModelTaskResponse status(SessionContext sessionContext, UUID taskId);
    PlatformModelTaskResponse cancel(SessionContext sessionContext, UUID taskId);
    List<PlatformModelTaskResponse> recoverable(SessionContext sessionContext, int limit);
}
