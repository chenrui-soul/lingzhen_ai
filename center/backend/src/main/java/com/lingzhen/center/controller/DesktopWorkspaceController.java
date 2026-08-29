package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopDoubaoAccountRequest;
import com.lingzhen.center.model.dto.desktop.DesktopDoubaoAccountResponse;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceSnapshotRequest;
import com.lingzhen.center.model.dto.desktop.DesktopWorkspaceSnapshotResponse;
import com.lingzhen.center.service.DesktopWorkspaceService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/v1/desktop")
public class DesktopWorkspaceController {

    private final DesktopWorkspaceService service;

    public DesktopWorkspaceController(DesktopWorkspaceService service) {
        this.service = service;
    }

    @GetMapping("/workspace/snapshot")
    @PreAuthorize("hasAuthority('PERM_sync.use')")
    public DesktopWorkspaceSnapshotResponse snapshot(Authentication authentication) {
        return service.snapshot(sessionAccess(authentication));
    }

    @PutMapping("/workspace/snapshot")
    @PreAuthorize("hasAuthority('PERM_sync.use')")
    public DesktopWorkspaceSnapshotResponse saveSnapshot(
            Authentication authentication,
            @Valid @RequestBody DesktopWorkspaceSnapshotRequest request
    ) {
        return service.saveSnapshot(sessionAccess(authentication), request);
    }

    @GetMapping("/doubao-accounts")
    @PreAuthorize("hasAuthority('PERM_doubao_account.use')")
    public List<DesktopDoubaoAccountResponse> doubaoAccounts(Authentication authentication) {
        return service.doubaoAccounts(sessionAccess(authentication));
    }

    @PutMapping("/doubao-accounts/{accountId}")
    @PreAuthorize("hasAuthority('PERM_doubao_account.use')")
    public DesktopDoubaoAccountResponse saveDoubaoAccount(
            Authentication authentication,
            @PathVariable String accountId,
            @Valid @RequestBody DesktopDoubaoAccountRequest request
    ) {
        return service.saveDoubaoAccount(sessionAccess(authentication), accountId, request);
    }

    @DeleteMapping("/doubao-accounts/{accountId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @PreAuthorize("hasAuthority('PERM_doubao_account.use')")
    public void removeDoubaoAccount(Authentication authentication, @PathVariable String accountId) {
        service.removeDoubaoAccount(sessionAccess(authentication), accountId);
    }

    private SessionContext sessionAccess(Authentication authentication) {
        if (authentication == null || !(authentication.getDetails() instanceof SessionContext access)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "登录会话无效或已过期");
        }
        return access;
    }
}
