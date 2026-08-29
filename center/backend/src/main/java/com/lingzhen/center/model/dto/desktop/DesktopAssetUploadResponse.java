package com.lingzhen.center.model.dto.desktop;

import java.time.Instant;

public record DesktopAssetUploadResponse(
        String assetId,
        String objectKey,
        String contentType,
        long size,
        String sha256,
        String url,
        Instant expiresAt
) { }
