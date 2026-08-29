package com.lingzhen.center.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import java.time.Clock;
import java.util.Base64;

@Configuration
public class AuthSecurityBeansConfig {

    private static final int MINIMUM_HMAC_BYTES = 32;

    @Bean
    Clock authClock() {
        return Clock.systemUTC();
    }

    @Bean
    SecretKey authHmacKey(AuthProperties properties) {
        if (properties.hmacSecret() == null || properties.hmacSecret().isBlank()) {
            throw new IllegalStateException("APP_AUTH_HMAC_SECRET is required");
        }

        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(properties.hmacSecret());
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("APP_AUTH_HMAC_SECRET must be Base64 encoded", exception);
        }
        if (decoded.length < MINIMUM_HMAC_BYTES) {
            throw new IllegalStateException("APP_AUTH_HMAC_SECRET must contain at least 32 bytes");
        }
        return new SecretKeySpec(decoded, "HmacSHA256");
    }

    @Bean
    JwtEncoder jwtEncoder(SecretKey authHmacKey) {
        return NimbusJwtEncoder.withSecretKey(authHmacKey)
                .algorithm(MacAlgorithm.HS256)
                .build();
    }

    @Bean
    JwtDecoder jwtDecoder(SecretKey authHmacKey, AuthProperties properties) {
        NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(authHmacKey)
                .macAlgorithm(MacAlgorithm.HS256)
                .build();
        decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(properties.issuer()));
        return decoder;
    }
}
