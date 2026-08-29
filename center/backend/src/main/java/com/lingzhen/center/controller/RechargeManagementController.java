package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
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
import com.lingzhen.center.service.RechargeManagementService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/management/credits")
public class RechargeManagementController {

    private final RechargeManagementService service;

    public RechargeManagementController(RechargeManagementService service) {
        this.service = service;
    }

    @GetMapping("/packages")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public RechargePackageListResponse packages(Authentication authentication) {
        return service.packages(sessionAccess(authentication));
    }

    @PostMapping("/packages")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ResponseEntity<RechargePackageResponse> createPackage(
            Authentication authentication,
            @Valid @RequestBody CreateRechargePackageRequest request
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(
                service.createPackage(sessionAccess(authentication), request)
        );
    }

    @PutMapping("/packages/{packageId}")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public RechargePackageResponse updatePackage(
            Authentication authentication,
            @PathVariable UUID packageId,
            @Valid @RequestBody UpdateRechargePackageRequest request
    ) {
        return service.updatePackage(sessionAccess(authentication), packageId, request);
    }

    @PostMapping("/sandbox/orders/{orderId}/events")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public SandboxPaymentSimulationResponse simulateSandboxPayment(
            Authentication authentication,
            @PathVariable UUID orderId,
            @Valid @RequestBody SandboxPaymentSimulationRequest request
    ) {
        return service.simulateSandboxPayment(sessionAccess(authentication), orderId, request);
    }

    @PostMapping("/manual/orders/{orderId}/approve")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ManualRechargeReviewResponse approveManualRecharge(
            Authentication authentication,
            @PathVariable UUID orderId,
            @Valid @RequestBody ManualRechargeReviewRequest request
    ) {
        return service.approveManualRecharge(sessionAccess(authentication), orderId, request);
    }

    @PostMapping("/manual/orders/{orderId}/reject")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ManualRechargeReviewResponse rejectManualRecharge(
            Authentication authentication,
            @PathVariable UUID orderId,
            @Valid @RequestBody ManualRechargeReviewRequest request
    ) {
        return service.rejectManualRecharge(sessionAccess(authentication), orderId, request);
    }

    @PostMapping("/grants")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public AdminCreditGrantResponse grantCredits(
            Authentication authentication,
            @Valid @RequestBody AdminCreditGrantRequest request
    ) {
        return service.grantCredits(sessionAccess(authentication), request);
    }

    private SessionContext sessionAccess(Authentication authentication) {
        if (authentication == null
                || !(authentication.getDetails() instanceof SessionContext access)) {
            throw new ApiException(
                    HttpStatus.UNAUTHORIZED,
                    "AUTHENTICATION_REQUIRED",
                    "登录会话无效或已过期"
            );
        }
        return access;
    }
}
