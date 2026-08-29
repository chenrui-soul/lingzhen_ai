package com.lingzhen.center.controller;

import com.lingzhen.center.config.AuthProperties;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.AuthResponse;
import com.lingzhen.center.model.dto.auth.LoginRequest;
import com.lingzhen.center.model.dto.auth.MeResponse;
import com.lingzhen.center.model.dto.auth.RefreshRequest;
import com.lingzhen.center.model.dto.auth.RegisterRequest;
import com.lingzhen.center.model.dto.auth.SelectTenantRequest;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.auth.TenantSelectionResponse;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.security.AuthCookieService;
import com.lingzhen.center.service.AuthService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.Duration;
import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api/v1/auth")
public class AuthController {

    private final AuthService authService;
    private final AuthCookieService cookieService;
    private final AuthProperties properties;

    public AuthController(
            AuthService authService,
            AuthCookieService cookieService,
            AuthProperties properties
    ) {
        this.authService = authService;
        this.cookieService = cookieService;
        this.properties = properties;
    }

    @PostMapping("/register")
    public ResponseEntity<AuthResponse> register(
            @Valid @RequestBody RegisterRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse
    ) {
        AuthService.AuthenticatedSession session = authService.register(
                request,
                metadata(servletRequest)
        );
        return ResponseEntity.status(HttpStatus.CREATED).body(
                response(session, servletResponse)
        );
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(
            @Valid @RequestBody LoginRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse
    ) {
        AuthService.LoginOutcome outcome = authService.login(request, metadata(servletRequest));
        if (outcome instanceof AuthService.AuthenticatedSession authenticated) {
            return ResponseEntity.ok(response(authenticated, servletResponse));
        }
        AuthService.TenantSelectionRequired selection =
                (AuthService.TenantSelectionRequired) outcome;
        return ResponseEntity.ok(new TenantSelectionResponse(
                "tenant_selection_required",
                selection.ticket(),
                selection.expiresAt(),
                selection.memberships().stream()
                        .map(membership -> new TenantSelectionResponse.TenantOption(
                                membership.tenantId(),
                                membership.tenantCode(),
                                membership.tenantName(),
                                membership.roleCode()
                        ))
                        .toList()
        ));
    }

    @PostMapping("/select-tenant")
    public ResponseEntity<AuthResponse> selectTenant(
            @Valid @RequestBody SelectTenantRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse
    ) {
        AuthService.AuthenticatedSession session = authService.selectTenant(
                request,
                metadata(servletRequest)
        );
        return ResponseEntity.ok(response(session, servletResponse));
    }

    @PostMapping("/refresh")
    public ResponseEntity<AuthResponse> refresh(
            @Valid @RequestBody(required = false) RefreshRequest request,
            HttpServletRequest servletRequest,
            HttpServletResponse servletResponse
    ) {
        String bodyToken = request == null ? null : request.refreshToken();
        String refreshToken = cookieService.resolveRefreshToken(bodyToken, servletRequest);
        AuthService.AuthenticatedSession session = authService.refresh(refreshToken);
        return ResponseEntity.ok(response(session, servletResponse));
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(
            Authentication authentication,
            HttpServletResponse response
    ) {
        SessionContext access = sessionAccess(authentication);
        authService.logout(access.sessionId());
        cookieService.clear(response);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public MeResponse me(Authentication authentication) {
        SessionContext access = sessionAccess(authentication);
        return new MeResponse(
                access.userId(),
                access.username(),
                access.email(),
                access.tenantId(),
                access.tenantCode(),
                access.tenantName(),
                access.membershipId(),
                access.sessionId(),
                access.deviceId(),
                access.clientType(),
                access.roleCode(),
                access.permissions(),
                access.featurePolicies(),
                access.expiresAt()
        );
    }

    private AuthResponse response(
            AuthService.AuthenticatedSession session,
            HttpServletResponse servletResponse
    ) {
        SessionContext access = session.access();
        String responseRefreshToken = session.refreshToken();
        if (access.clientType() == ClientType.MANAGEMENT_WEB) {
            Duration maxAge = Duration.between(Instant.now(), session.refreshTokenExpiresAt());
            cookieService.writeManagementCredentials(
                    servletResponse,
                    session.refreshToken(),
                    maxAge.isNegative() ? properties.refreshTokenTtl() : maxAge
            );
            responseRefreshToken = null;
        }
        return new AuthResponse(
                "authenticated",
                "Bearer",
                session.accessToken(),
                session.accessTokenExpiresAt(),
                responseRefreshToken,
                session.refreshTokenExpiresAt(),
                new AuthResponse.SessionSummary(
                        access.sessionId(),
                        access.membershipId(),
                        access.deviceId(),
                        access.clientType()
                ),
                new AuthResponse.UserSummary(access.userId(), access.username(), access.email()),
                new AuthResponse.TenantSummary(
                        access.tenantId(),
                        access.tenantCode(),
                        access.tenantName()
                ),
                access.roleCode(),
                access.permissions(),
                access.featurePolicies()
        );
    }

    private AuthService.RequestMetadata metadata(HttpServletRequest request) {
        return new AuthService.RequestMetadata(request.getHeader("User-Agent"));
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
