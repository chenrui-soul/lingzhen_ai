package com.lingzhen.center.service.impl;

import com.lingzhen.center.repository.PlatformModelTaskRepository;
import com.lingzhen.center.service.PlatformTaskBillingService;
import com.lingzhen.center.service.PlatformTaskTransitionService;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

@Service
public class PlatformTaskTransitionServiceImpl implements PlatformTaskTransitionService {
    private final PlatformModelTaskRepository tasks;
    private final PlatformTaskBillingService billing;

    public PlatformTaskTransitionServiceImpl(PlatformModelTaskRepository tasks,
                                             PlatformTaskBillingService billing) {
        this.tasks = tasks;
        this.billing = billing;
    }

    @Override
    @Transactional
    public boolean transition(
            TransitionCommand command,
            BillingAction billingAction,
            String resultReference
    ) {
        java.util.Optional<PlatformModelTaskRepository.TaskRow> stored = tasks.update(
                new PlatformModelTaskRepository.UpdateCommand(
                        command.id(), command.tenantId(), command.userId(), command.state(),
                        command.providerJobId(), command.resultUrls(), command.resultText(),
                        command.errorCode(), command.errorMessage(), command.rowVersion()
                ));
        stored.ifPresent(task -> apply(task.id(), billingAction, resultReference));
        return stored.isPresent();
    }

    @Override
    @Transactional
    public void reconcile(UUID taskId, BillingAction billingAction, String resultReference) {
        apply(taskId, billingAction, resultReference);
    }

    private void apply(UUID taskId, BillingAction action, String resultReference) {
        switch (action) {
            case SETTLE -> billing.settle(taskId, resultReference);
            case RELEASE -> billing.release(taskId);
            case NONE -> { }
        }
    }
}
