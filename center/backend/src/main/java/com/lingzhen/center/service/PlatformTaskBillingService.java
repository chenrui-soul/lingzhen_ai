package com.lingzhen.center.service;

import java.util.UUID;

public interface PlatformTaskBillingService {

    void reserve(ReservationRequest request);

    void settle(UUID taskId, String resultReference);

    void release(UUID taskId);

    record ReservationRequest(UUID taskId, UUID tenantId, UUID userId, UUID modelId,
                              String clientRequestId) {
    }
}
