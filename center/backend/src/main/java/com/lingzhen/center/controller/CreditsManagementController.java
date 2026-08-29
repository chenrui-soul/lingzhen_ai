package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.ManagementCreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditReservationAnomalyPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementCreditWalletPageResponse;
import com.lingzhen.center.model.dto.billing.ManagementRechargeOrderPageResponse;
import com.lingzhen.center.service.CreditsManagementService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/management/credits")
public class CreditsManagementController {

    private final CreditsManagementService service;

    public CreditsManagementController(CreditsManagementService service) {
        this.service = service;
    }

    @GetMapping("/wallets")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ManagementCreditWalletPageResponse wallets(
            Authentication authentication,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String status
    ) {
        return service.wallets(sessionAccess(authentication), cursor, limit, keyword, status);
    }

    @GetMapping("/orders")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ManagementRechargeOrderPageResponse orders(
            Authentication authentication,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String status
    ) {
        return service.orders(sessionAccess(authentication), cursor, limit, keyword, status);
    }

    @GetMapping("/ledger")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ManagementCreditLedgerPageResponse ledger(
            Authentication authentication,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String entryType
    ) {
        return service.ledger(sessionAccess(authentication), cursor, limit, keyword, entryType);
    }

    @GetMapping("/reservations/anomalies")
    @PreAuthorize("hasAuthority('PERM_credits.manage')")
    public ManagementCreditReservationAnomalyPageResponse reservationAnomalies(
            Authentication authentication,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String anomalyType
    ) {
        return service.reservationAnomalies(
                sessionAccess(authentication), cursor, limit, keyword, anomalyType
        );
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
