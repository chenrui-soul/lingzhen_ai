package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopModelCatalogResponse;
import com.lingzhen.center.service.DesktopModelCatalogService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/desktop/models")
public class DesktopModelController {

    private final DesktopModelCatalogService service;

    public DesktopModelController(DesktopModelCatalogService service) {
        this.service = service;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_model.use')")
    public DesktopModelCatalogResponse models(Authentication authentication) {
        return service.load(sessionAccess(authentication));
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
