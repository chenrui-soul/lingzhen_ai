package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskRequest;
import com.lingzhen.center.model.dto.desktop.PlatformModelTaskResponse;
import com.lingzhen.center.service.PlatformModelProxyService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.UUID;
import java.util.List;

@RestController
@RequestMapping("/api/v1/desktop/platform-model-tasks")
public class DesktopPlatformModelController {
    private final PlatformModelProxyService service;

    public DesktopPlatformModelController(PlatformModelProxyService service) {
        this.service = service;
    }

    @PostMapping
    @PreAuthorize("hasAuthority('PERM_model.use')")
    public PlatformModelTaskResponse submit(Authentication authentication,
                                             @Valid @RequestBody PlatformModelTaskRequest request) {
        return service.submit(sessionAccess(authentication), request);
    }

    @GetMapping("/{taskId}")
    @PreAuthorize("hasAuthority('PERM_model.use')")
    public PlatformModelTaskResponse status(Authentication authentication, @PathVariable UUID taskId) {
        return service.status(sessionAccess(authentication), taskId);
    }

    @GetMapping("/recoverable")
    @PreAuthorize("hasAuthority('PERM_model.use')")
    public List<PlatformModelTaskResponse> recoverable(Authentication authentication,
                                                        @RequestParam(defaultValue = "50") int limit) {
        return service.recoverable(sessionAccess(authentication), limit);
    }

    @PostMapping("/{taskId}/cancel")
    @PreAuthorize("hasAuthority('PERM_model.use')")
    public PlatformModelTaskResponse cancel(Authentication authentication, @PathVariable UUID taskId) {
        return service.cancel(sessionAccess(authentication), taskId);
    }

    private SessionContext sessionAccess(Authentication authentication) {
        if (authentication == null || !(authentication.getDetails() instanceof SessionContext access)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "登录会话无效或已过期");
        }
        return access;
    }
}
