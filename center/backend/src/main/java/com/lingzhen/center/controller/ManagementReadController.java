package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.management.ManagementDashboardResponse;
import com.lingzhen.center.model.dto.management.ManagementTenantResponse;
import com.lingzhen.center.model.dto.management.ManagementUserPageResponse;
import com.lingzhen.center.service.ManagementReadService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/management")
public class ManagementReadController {

    private final ManagementReadService service;

    public ManagementReadController(ManagementReadService service) {
        this.service = service;
    }

    @GetMapping("/dashboard")
    @PreAuthorize("hasAuthority('PERM_tenant.read')")
    public ManagementDashboardResponse dashboard(Authentication authentication) {
        return service.dashboard(sessionAccess(authentication));
    }

    @GetMapping("/users")
    @PreAuthorize("hasAuthority('PERM_membership.read')")
    public ManagementUserPageResponse users(
            Authentication authentication,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String status
    ) {
        return service.users(sessionAccess(authentication), page, pageSize, keyword, status);
    }

    @GetMapping("/tenant")
    @PreAuthorize("hasAuthority('PERM_tenant.read')")
    public ManagementTenantResponse tenant(Authentication authentication) {
        return service.tenant(sessionAccess(authentication));
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
