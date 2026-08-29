package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.billing.CreateRechargeOrderRequest;
import com.lingzhen.center.model.dto.billing.RechargeOrderResponse;
import com.lingzhen.center.model.dto.billing.RechargeOrderListResponse;
import com.lingzhen.center.model.dto.billing.RechargePackageListResponse;
import com.lingzhen.center.service.RechargeService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1")
public class RechargeController {

    private final RechargeService service;

    public RechargeController(RechargeService service) {
        this.service = service;
    }

    @GetMapping("/recharge-packages")
    @PreAuthorize("hasAuthority('PERM_credits.self.recharge')")
    public RechargePackageListResponse packages(Authentication authentication) {
        return service.activePackages(sessionAccess(authentication));
    }

    @PostMapping("/recharge-orders")
    @PreAuthorize("hasAuthority('PERM_credits.self.recharge')")
    public ResponseEntity<RechargeOrderResponse> createOrder(
            Authentication authentication,
            @RequestHeader(name = "Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody CreateRechargeOrderRequest request
    ) {
        RechargeOrderResponse response = service.createOrder(
                sessionAccess(authentication), idempotencyKey, request
        );
        return ResponseEntity.status(
                response.idempotentReplay() ? HttpStatus.OK : HttpStatus.CREATED
        ).body(response);
    }

    @GetMapping("/recharge-orders/{orderId}")
    @PreAuthorize("hasAuthority('PERM_credits.self.recharge')")
    public RechargeOrderResponse order(
            Authentication authentication,
            @PathVariable UUID orderId
    ) {
        return service.order(sessionAccess(authentication), orderId);
    }

    @GetMapping("/recharge-orders")
    @PreAuthorize("hasAuthority('PERM_credits.self.recharge')")
    public RechargeOrderListResponse orders(
            Authentication authentication,
            @RequestParam(defaultValue = "20") int limit
    ) {
        return service.orders(sessionAccess(authentication), limit);
    }

    @PostMapping("/recharge-orders/{orderId}/cancel")
    @PreAuthorize("hasAuthority('PERM_credits.self.recharge')")
    public RechargeOrderResponse cancelOrder(
            Authentication authentication,
            @PathVariable UUID orderId
    ) {
        return service.cancelOrder(sessionAccess(authentication), orderId);
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
