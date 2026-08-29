package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopAssetUploadResponse;
import org.springframework.web.multipart.MultipartFile;

public interface DesktopAssetStorageService {
    DesktopAssetUploadResponse uploadReference(SessionContext sessionContext, MultipartFile file);
}
