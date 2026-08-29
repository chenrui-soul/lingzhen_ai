package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.LoginRequest;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.dto.auth.SelectTenantRequest;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.auth.TenantMembershipView;
import com.lingzhen.center.model.enums.ClientType;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public interface AuthService {

    AuthenticatedSession register(RegisterRequest request, RequestMetadata metadata);

    LoginOutcome login(LoginRequest request, RequestMetadata metadata);

    AuthenticatedSession selectTenant(SelectTenantRequest request, RequestMetadata metadata);

    AuthenticatedSession refresh(String rawRefreshToken);

    void logout(UUID sessionId);

    sealed interface LoginOutcome permits AuthenticatedSession, TenantSelectionRequired {
    }

    record AuthenticatedSession(
            SessionContext access,
            String accessToken,
            Instant accessTokenExpiresAt,
            String refreshToken,
            Instant refreshTokenExpiresAt
    ) implements LoginOutcome {
    }

    record TenantSelectionRequired(
            String ticket,
            Instant expiresAt,
            List<TenantMembershipView> memberships
    ) implements LoginOutcome {
    }

    record RequestMetadata(String userAgent) {
    }

    record SessionClient(ClientType clientType, UUID sessionId) {
    }
}
