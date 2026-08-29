package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargePackageRequest;
import com.lingzhen.center.model.dto.billing.AdminCreditGrantRequest;
import com.lingzhen.center.model.dto.billing.AdminCreditGrantResponse;
import com.lingzhen.center.model.dto.billing.ManualRechargeReviewRequest;
import com.lingzhen.center.model.dto.billing.ManualRechargeReviewResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageListResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageResponse;
import com.lingzhen.center.model.dto.billing.SandboxPaymentSimulationRequest;
import com.lingzhen.center.model.dto.billing.SandboxPaymentSimulationResponse;
import com.lingzhen.center.model.dto.billing.UpdateRechargePackageRequest;

import java.util.UUID;

public interface RechargeManagementService {

    RechargePackageListResponse packages(SessionContext sessionContext);

    RechargePackageResponse createPackage(
            SessionContext sessionContext,
            CreateRechargePackageRequest request
    );

    RechargePackageResponse updatePackage(
            SessionContext sessionContext,
            UUID packageId,
            UpdateRechargePackageRequest request
    );

    SandboxPaymentSimulationResponse simulateSandboxPayment(
            SessionContext sessionContext,
            UUID orderId,
            SandboxPaymentSimulationRequest request
    );

    ManualRechargeReviewResponse approveManualRecharge(
            SessionContext sessionContext,
            UUID orderId,
            ManualRechargeReviewRequest request
    );

    ManualRechargeReviewResponse rejectManualRecharge(
            SessionContext sessionContext,
            UUID orderId,
            ManualRechargeReviewRequest request
    );

    AdminCreditGrantResponse grantCredits(SessionContext sessionContext, AdminCreditGrantRequest request);
}
