package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopAssetUploadResponse;
import com.lingzhen.center.service.DesktopAssetStorageService;
import org.springframework.http.HttpStatus;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/desktop/assets")
public class DesktopAssetController {
    private final DesktopAssetStorageService service;

    public DesktopAssetController(DesktopAssetStorageService service) { this.service = service; }

    @PostMapping("/upload")
    @PreAuthorize("hasAuthority('PERM_asset.use')")
    public DesktopAssetUploadResponse upload(Authentication authentication, @RequestParam("file") MultipartFile file) {
        return service.uploadReference(sessionAccess(authentication), file);
    }

    private SessionContext sessionAccess(Authentication authentication) {
        if (authentication == null || !(authentication.getDetails() instanceof SessionContext access)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "AUTHENTICATION_REQUIRED", "登录会话无效或已过期");
        }
        return access;
    }
}
