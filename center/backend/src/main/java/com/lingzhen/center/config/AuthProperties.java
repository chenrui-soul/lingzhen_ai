package com.lingzhen.center.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

@ConfigurationProperties("app.auth")
public record AuthProperties(
        String issuer,
        String hmacSecret,
        Duration accessTokenTtl,
        Duration refreshTokenTtl,
        Duration tenantSelectionTicketTtl,
        int loginLockThreshold,
        Duration loginLockDuration,
        boolean secureCookies
) {
}
