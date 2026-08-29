package com.lingzhen.center.service;

import java.util.List;
import java.util.UUID;

public interface PlatformTaskTransitionService {

    boolean transition(
            TransitionCommand command,
            BillingAction billingAction,
            String resultReference
    );

    void reconcile(UUID taskId, BillingAction billingAction, String resultReference);

    enum BillingAction {
        NONE,
        SETTLE,
        RELEASE
    }

    record TransitionCommand(UUID id, UUID tenantId, UUID userId, String state,
                             String providerJobId, List<String> resultUrls, String resultText,
                             String errorCode, String errorMessage, long rowVersion) {
    }
}
