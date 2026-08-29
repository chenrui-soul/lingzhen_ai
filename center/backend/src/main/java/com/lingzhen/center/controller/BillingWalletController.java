package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreditLedgerPageResponse;
import com.lingzhen.center.model.dto.billing.CreditWalletResponse;
import com.lingzhen.center.service.BillingWalletService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/credits")
public class BillingWalletController {

    private final BillingWalletService service;

    public BillingWalletController(BillingWalletService service) {
        this.service = service;
    }

    @GetMapping("/wallet")
    @PreAuthorize("hasAuthority('PERM_credits.self.read')")
    public CreditWalletResponse wallet(Authentication authentication) {
        return service.wallet(sessionAccess(authentication));
    }

    @GetMapping("/ledger")
    @PreAuthorize("hasAuthority('PERM_credits.self.read')")
    public CreditLedgerPageResponse ledger(
            Authentication authentication,
            @RequestParam(required = false) String cursor,
            @RequestParam(defaultValue = "20") int limit
    ) {
        return service.ledger(sessionAccess(authentication), cursor, limit);
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
