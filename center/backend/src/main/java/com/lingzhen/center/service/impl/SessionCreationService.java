package com.lingzhen.center.service.impl;

import com.lingzhen.center.config.AuthProperties;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.DeviceRequest;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.auth.TenantMembershipView;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.repository.AuthIdentityStore;
import com.lingzhen.center.security.AccessTokenIssuer;
import com.lingzhen.center.security.SecureTokenGenerator;
import com.lingzhen.center.service.AuthService;
import com.lingzhen.center.util.TextLimitUtil;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.UUID;

@Service
public class SessionCreationService {

    private final AuthIdentityStore identityStore;
    private final SecureTokenGenerator tokenGenerator;
    private final AccessTokenIssuer accessTokenIssuer;
    private final AuthProperties properties;

    public SessionCreationService(
            AuthIdentityStore identityStore,
            SecureTokenGenerator tokenGenerator,
            AccessTokenIssuer accessTokenIssuer,
            AuthProperties properties
    ) {
        this.identityStore = identityStore;
        this.tokenGenerator = tokenGenerator;
        this.accessTokenIssuer = accessTokenIssuer;
        this.properties = properties;
    }

    AuthService.AuthenticatedSession create(
            UUID userId,
            TenantMembershipView membership,
            ClientType clientType,
            DeviceRequest deviceRequest,
            AuthService.RequestMetadata metadata,
            Instant now
    ) {
        AuthIdentityStore.Device device = identityStore.registerOrUpdateDevice(
                new AuthIdentityStore.DeviceRegistration(
                        membership.tenantId(),
                        clientType,
                        deviceRequest.deviceHash(),
                        (short) deviceRequest.fingerprintVersion(),
                        TextLimitUtil.trimToNull(deviceRequest.displayName(), 160),
                        TextLimitUtil.trimToNull(deviceRequest.platform(), 32),
                        TextLimitUtil.trimToNull(deviceRequest.architecture(), 32),
                        TextLimitUtil.trimToNull(deviceRequest.appVersion(), 32)
                ),
                now
        );
        if ("blocked".equals(device.trustStatus())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "DEVICE_BLOCKED", "当前设备已被阻止");
        }

        UUID sessionId = UUID.randomUUID();
        Instant refreshExpiresAt = now.plus(properties.refreshTokenTtl());
        identityStore.createSession(new AuthIdentityStore.NewSession(
                sessionId,
                userId,
                membership.tenantId(),
                membership.id(),
                device.id(),
                clientType,
                now,
                refreshExpiresAt,
                TextLimitUtil.trimToNull(metadata.userAgent(), 500)
        ));

        SecureTokenGenerator.OpaqueToken refreshToken = tokenGenerator.generate();
        UUID refreshTokenId = UUID.randomUUID();
        UUID familyId = UUID.randomUUID();
        identityStore.createRefreshToken(new AuthIdentityStore.NewRefreshToken(
                refreshTokenId,
                sessionId,
                familyId,
                null,
                refreshToken.hash(),
                now,
                refreshExpiresAt
        ));

        SessionContext access = identityStore.findSessionAccess(sessionId, now)
                .orElseThrow(() -> new IllegalStateException("New session failed its own access validation"));
        AccessTokenIssuer.IssuedAccessToken accessToken = accessTokenIssuer.issue(access, now);
        return new AuthService.AuthenticatedSession(
                access,
                accessToken.value(),
                accessToken.expiresAt(),
                refreshToken.value(),
                refreshExpiresAt
        );
    }
}
