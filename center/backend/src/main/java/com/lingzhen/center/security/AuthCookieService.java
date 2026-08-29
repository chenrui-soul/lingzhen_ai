package com.lingzhen.center.security;

import com.lingzhen.center.config.AuthProperties;
import com.lingzhen.center.exception.ApiException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.stereotype.Component;
import org.springframework.web.util.WebUtils;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Arrays;

@Component
public class AuthCookieService {

    private static final String REFRESH_COOKIE = "LZ_REFRESH";
    private static final String CSRF_COOKIE = "LZ_CSRF";
    private static final String CSRF_HEADER = "X-CSRF-Token";
    private static final String REFRESH_COOKIE_PATH = "/api/v1/auth";
    private static final String CSRF_COOKIE_PATH = "/";

    private final AuthProperties properties;
    private final SecureTokenGenerator tokenGenerator;

    public AuthCookieService(
            AuthProperties properties,
            SecureTokenGenerator tokenGenerator
    ) {
        this.properties = properties;
        this.tokenGenerator = tokenGenerator;
    }

    public void writeManagementCredentials(
            HttpServletResponse response,
            String refreshToken,
            Duration maxAge
    ) {
        String csrfToken = tokenGenerator.generate().value();
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                REFRESH_COOKIE,
                refreshToken,
                maxAge,
                true,
                REFRESH_COOKIE_PATH
        ).toString());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                CSRF_COOKIE,
                "",
                Duration.ZERO,
                false,
                REFRESH_COOKIE_PATH
        ).toString());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                CSRF_COOKIE,
                csrfToken,
                maxAge,
                false,
                CSRF_COOKIE_PATH
        ).toString());
    }

    public String resolveRefreshToken(String bodyToken, HttpServletRequest request) {
        if (bodyToken != null && !bodyToken.isBlank()) {
            return bodyToken.trim();
        }
        Cookie refreshCookie = WebUtils.getCookie(request, REFRESH_COOKIE);
        if (refreshCookie == null || refreshCookie.getValue().isBlank()) {
            return null;
        }
        requireManagementCsrf(request);
        return refreshCookie.getValue();
    }

    public void clear(HttpServletResponse response) {
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                REFRESH_COOKIE,
                "",
                Duration.ZERO,
                true,
                REFRESH_COOKIE_PATH
        ).toString());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                CSRF_COOKIE,
                "",
                Duration.ZERO,
                false,
                CSRF_COOKIE_PATH
        ).toString());
        response.addHeader(HttpHeaders.SET_COOKIE, cookie(
                CSRF_COOKIE,
                "",
                Duration.ZERO,
                false,
                REFRESH_COOKIE_PATH
        ).toString());
    }

    public void requireManagementCsrf(HttpServletRequest request) {
        String csrfHeader = request.getHeader(CSRF_HEADER);
        boolean matches = csrfHeader != null
                && request.getCookies() != null
                && Arrays.stream(request.getCookies())
                .filter(cookie -> CSRF_COOKIE.equals(cookie.getName()))
                .anyMatch(cookie -> MessageDigest.isEqual(
                        cookie.getValue().getBytes(StandardCharsets.UTF_8),
                        csrfHeader.getBytes(StandardCharsets.UTF_8)
                ));
        if (!matches) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "CSRF_VALIDATION_FAILED",
                    "管理中心写请求缺少有效的 CSRF 凭据"
            );
        }
    }

    private ResponseCookie cookie(
            String name,
            String value,
            Duration maxAge,
            boolean httpOnly,
            String path
    ) {
        return ResponseCookie.from(name, value)
                .httpOnly(httpOnly)
                .secure(properties.secureCookies())
                .sameSite("Strict")
                .path(path)
                .maxAge(maxAge)
                .build();
    }
}
