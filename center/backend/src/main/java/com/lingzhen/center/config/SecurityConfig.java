package com.lingzhen.center.config;

import com.lingzhen.center.security.RestAccessDeniedHandler;
import com.lingzhen.center.security.RestAuthenticationEntryPoint;
import com.lingzhen.center.security.ManagementCsrfFilter;
import com.lingzhen.center.security.SessionValidationFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private static final String[] PUBLIC_ENDPOINTS = {
            "/health/live",
            "/health/ready",
            "/v3/api-docs/**",
            "/swagger-ui.html",
            "/swagger-ui/**",
            "/api/v1/auth/register",
            "/api/v1/auth/login",
            "/api/v1/auth/select-tenant",
            "/api/v1/auth/refresh"
    };

    @Bean
    SecurityFilterChain securityFilterChain(
            HttpSecurity http,
            SessionValidationFilter sessionValidationFilter,
            ManagementCsrfFilter managementCsrfFilter,
            RestAuthenticationEntryPoint authenticationEntryPoint,
            RestAccessDeniedHandler accessDeniedHandler
    ) throws Exception {
        http
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(PUBLIC_ENDPOINTS).permitAll()
                        .requestMatchers("/api/v1/auth/me", "/api/v1/auth/logout").authenticated()
                        .requestMatchers("/api/v1/desktop/**").hasAuthority("CLIENT_desktop")
                        .requestMatchers("/api/v1/credits/**").hasAuthority("CLIENT_desktop")
                        .requestMatchers("/api/v1/recharge-packages", "/api/v1/recharge-orders/**")
                        .hasAuthority("CLIENT_desktop")
                        .requestMatchers("/api/v1/management/**")
                        .hasAuthority("CLIENT_management_web")
                        .anyRequest().denyAll())
                .csrf(AbstractHttpConfigurer::disable)
                .httpBasic(httpBasic -> httpBasic.disable())
                .formLogin(formLogin -> formLogin.disable())
                .sessionManagement(session -> session
                        .sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                .logout(AbstractHttpConfigurer::disable)
                .exceptionHandling(exceptions -> exceptions
                        .authenticationEntryPoint(authenticationEntryPoint)
                        .accessDeniedHandler(accessDeniedHandler))
                .oauth2ResourceServer(resourceServer -> resourceServer
                        .jwt(jwt -> {
                        })
                        .authenticationEntryPoint(authenticationEntryPoint))
                .addFilterAfter(sessionValidationFilter, BearerTokenAuthenticationFilter.class)
                .addFilterAfter(managementCsrfFilter, SessionValidationFilter.class);

        return http.build();
    }

    @Bean
    FilterRegistrationBean<ManagementCsrfFilter> managementCsrfFilterRegistration(
            ManagementCsrfFilter filter
    ) {
        FilterRegistrationBean<ManagementCsrfFilter> registration =
                new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }
}
