package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelListResponse;
import com.lingzhen.center.model.dto.modelcatalog.TenantModelPolicyResponse;
import com.lingzhen.center.model.dto.modelcatalog.UpdateTenantModelPolicyRequest;
import com.lingzhen.center.service.TenantModelCommandService;
import com.lingzhen.center.service.TenantModelQueryService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/management/tenant-models")
public class TenantModelController {

    private final TenantModelQueryService queryService;
    private final TenantModelCommandService commandService;

    public TenantModelController(
            TenantModelQueryService queryService,
            TenantModelCommandService commandService
    ) {
        this.queryService = queryService;
        this.commandService = commandService;
    }

    @GetMapping
    @PreAuthorize("hasAuthority('PERM_tenant_model.read')")
    public TenantModelListResponse models(Authentication authentication) {
        return queryService.models(sessionAccess(authentication));
    }

    @PutMapping("/{modelId}")
    @PreAuthorize("hasAuthority('PERM_tenant_model.manage')")
    public TenantModelPolicyResponse updatePolicy(
            Authentication authentication,
            @PathVariable UUID modelId,
            @Valid @org.springframework.web.bind.annotation.RequestBody
            UpdateTenantModelPolicyRequest request
    ) {
        return commandService.updatePolicy(sessionAccess(authentication), modelId, request);
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
