package com.lingzhen.center.security;

import com.lingzhen.center.model.dto.auth.SessionClaims;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.enums.ClientType;
import com.lingzhen.center.service.SessionAccessService;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.InsufficientAuthenticationException;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

@Component
public class SessionValidationFilter extends OncePerRequestFilter {

    private final SessionAccessService sessionAccessService;
    private final RestAuthenticationEntryPoint authenticationEntryPoint;

    public SessionValidationFilter(
            @Lazy SessionAccessService sessionAccessService,
            RestAuthenticationEntryPoint authenticationEntryPoint
    ) {
        this.sessionAccessService = sessionAccessService;
        this.authenticationEntryPoint = authenticationEntryPoint;
    }

    @Override
    protected void doFilterInternal(
            HttpServletRequest request,
            HttpServletResponse response,
            FilterChain filterChain
    ) throws ServletException, IOException {
        if (!(SecurityContextHolder.getContext().getAuthentication()
                instanceof JwtAuthenticationToken jwtAuthentication)) {
            filterChain.doFilter(request, response);
            return;
        }

        Optional<SessionContext> access = parseClaims(jwtAuthentication)
                .flatMap(sessionAccessService::verify);
        if (access.isEmpty()) {
            SecurityContextHolder.clearContext();
            authenticationEntryPoint.commence(
                    request,
                    response,
                    new InsufficientAuthenticationException("Session is no longer valid")
            );
            return;
        }

        SessionContext verified = access.get();
        JwtAuthenticationToken validated = new JwtAuthenticationToken(
                jwtAuthentication.getToken(),
                authorities(verified),
                verified.userId().toString()
        );
        validated.setDetails(verified);
        SecurityContextHolder.getContext().setAuthentication(validated);
        filterChain.doFilter(request, response);
    }

    private Optional<SessionClaims> parseClaims(
            JwtAuthenticationToken authentication
    ) {
        try {
            return Optional.of(new SessionClaims(
                    UUID.fromString(authentication.getToken().getClaimAsString("sid")),
                    UUID.fromString(authentication.getToken().getSubject()),
                    UUID.fromString(authentication.getToken().getClaimAsString("tenant_id")),
                    UUID.fromString(authentication.getToken().getClaimAsString("membership_id")),
                    UUID.fromString(authentication.getToken().getClaimAsString("device_id")),
                    ClientType.fromValue(authentication.getToken().getClaimAsString("client_type"))
            ));
        } catch (RuntimeException exception) {
            return Optional.empty();
        }
    }

    private List<GrantedAuthority> authorities(SessionContext access) {
        List<GrantedAuthority> authorities = new ArrayList<>();
        authorities.add(new SimpleGrantedAuthority("CLIENT_" + access.clientType().value()));
        authorities.add(new SimpleGrantedAuthority("ROLE_" + access.roleCode()));
        access.permissions().stream()
                .sorted()
                .map(permission -> new SimpleGrantedAuthority("PERM_" + permission))
                .forEach(authorities::add);
        return authorities;
    }
}
