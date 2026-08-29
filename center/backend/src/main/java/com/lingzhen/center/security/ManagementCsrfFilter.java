package com.lingzhen.center.security;

import com.lingzhen.center.config.RequestIdFilter;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.common.ErrorResponse;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Map;
import java.util.Set;

@Component
public class ManagementCsrfFilter extends OncePerRequestFilter {

    private static final String MANAGEMENT_PATH = "/api/v1/management/";
    private static final Set<String> SAFE_METHODS = Set.of("GET", "HEAD", "OPTIONS", "TRACE");

    private final AuthCookieService authCookieService;
    private final ObjectMapper objectMapper;

    public ManagementCsrfFilter(
            AuthCookieService authCookieService,
            ObjectMapper objectMapper
    ) {
        this.authCookieService = authCookieService;
        this.objectMapper = objectMapper;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return SAFE_METHODS.contains(request.getMethod())
                || !requestPath(request).startsWith(MANAGEMENT_PATH);
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        boolean managementWeb = authentication != null
                && authentication.isAuthenticated()
                && authentication.getAuthorities().stream()
                .anyMatch(authority -> "CLIENT_management_web".equals(authority.getAuthority()));
        if (!managementWeb) {
            filterChain.doFilter(request, response);
            return;
        }

        try {
            authCookieService.requireManagementCsrf(request);
            filterChain.doFilter(request, response);
        } catch (ApiException exception) {
            response.setStatus(exception.status().value());
            response.setContentType(MediaType.APPLICATION_JSON_VALUE);
            response.setCharacterEncoding(StandardCharsets.UTF_8.name());
            objectMapper.writeValue(response.getOutputStream(), new ErrorResponse(
                    Instant.now(),
                    requestId(request),
                    exception.code(),
                    exception.getMessage(),
                    Map.of()
            ));
        }
    }

    private String requestId(HttpServletRequest request) {
        Object value = request.getAttribute(RequestIdFilter.ATTRIBUTE);
        return value == null ? "unavailable" : value.toString();
    }

    private String requestPath(HttpServletRequest request) {
        String requestUri = request.getRequestURI();
        String contextPath = request.getContextPath();
        if (contextPath != null
                && !contextPath.isEmpty()
                && requestUri.startsWith(contextPath)) {
            return requestUri.substring(contextPath.length());
        }
        return requestUri;
    }
}
