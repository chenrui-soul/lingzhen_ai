package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.MinioStorageProperties;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.desktop.DesktopAssetUploadResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.DesktopAssetStorageService;
import io.minio.MinioClient;
import io.minio.PutObjectArgs;
import io.minio.GetPresignedObjectUrlArgs;
import io.minio.http.Method;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.InputStream;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Locale;
import java.util.UUID;

@Service
public class DesktopAssetStorageServiceImpl implements DesktopAssetStorageService {
    private static final long MAX_REFERENCE_BYTES = 32L * 1024 * 1024;

    private final MinioClient minio;
    private final MinioStorageProperties properties;

    public DesktopAssetStorageServiceImpl(MinioClient minio, MinioStorageProperties properties) {
        this.minio = minio;
        this.properties = properties;
    }

    @Override
    public DesktopAssetUploadResponse uploadReference(SessionContext context, MultipartFile file) {
        requireDesktop(context);
        if (!properties.isEnabled()) throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ASSET_STORAGE_DISABLED", "素材上传服务暂未启用");
        if (file == null || file.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "ASSET_FILE_REQUIRED", "请选择要上传的图片");
        if (file.getSize() > MAX_REFERENCE_BYTES) throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "ASSET_FILE_TOO_LARGE", "参考图片不能超过 32MB");
        String contentType = normalizeContentType(file.getContentType());
        if (!contentType.startsWith("image/")) throw new ApiException(HttpStatus.BAD_REQUEST, "ASSET_TYPE_NOT_SUPPORTED", "平台模型参考素材目前只支持图片");

        String extension = extension(contentType, file.getOriginalFilename());
        String assetId = UUID.randomUUID().toString();
        String objectKey = context.tenantId() + "/" + context.userId() + "/references/" + assetId + extension;
        String sha256;
        try (InputStream input = file.getInputStream()) {
            sha256 = sha256(file.getBytes());
        } catch (Exception error) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "ASSET_READ_FAILED", "参考图片读取失败");
        }
        try (InputStream input = file.getInputStream()) {
            minio.putObject(PutObjectArgs.builder()
                    .bucket(properties.getBucket())
                    .object(objectKey)
                    .stream(input, file.getSize(), -1)
                    .contentType(contentType)
                    .build());
            int expiry = Math.max(1, Math.min(7 * 24 * 60, properties.getPresignMinutes()));
            Instant expiresAt = Instant.now().plus(Duration.ofMinutes(expiry));
            String url = minio.getPresignedObjectUrl(GetPresignedObjectUrlArgs.builder()
                    .method(Method.GET)
                    .bucket(properties.getBucket())
                    .object(objectKey)
                    .expiry(expiry * 60)
                    .build());
            return new DesktopAssetUploadResponse(assetId, objectKey, contentType, file.getSize(), sha256, url, expiresAt);
        } catch (Exception error) {
            throw new ApiException(HttpStatus.SERVICE_UNAVAILABLE, "ASSET_UPLOAD_FAILED", "参考图片上传失败，请稍后重试");
        }
    }

    private void requireDesktop(SessionContext context) {
        if (context == null || context.clientType() != ClientType.DESKTOP || !context.permissions().contains("asset.use")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "DESKTOP_ASSET_FORBIDDEN", "当前账号没有上传素材的权限");
        }
    }

    private String normalizeContentType(String value) {
        String type = String.valueOf(value == null ? "" : value).trim().toLowerCase(Locale.ROOT);
        return type.startsWith("image/") ? type : "";
    }

    private String extension(String contentType, String originalName) {
        String name = String.valueOf(originalName == null ? "" : originalName).toLowerCase(Locale.ROOT);
        if (name.endsWith(".png") || "image/png".equals(contentType)) return ".png";
        if (name.endsWith(".webp") || "image/webp".equals(contentType)) return ".webp";
        if (name.endsWith(".gif") || "image/gif".equals(contentType)) return ".gif";
        return ".jpg";
    }

    private String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }
}
