package com.lingzhen.center.security;

import org.springframework.stereotype.Component;

import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

@Component
public class SecureOpaqueTokenGenerator implements SecureTokenGenerator {

    private static final int TOKEN_BYTES = 32;

    private final SecureRandom secureRandom = new SecureRandom();

    @Override
    public OpaqueToken generate() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        String value = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        return new OpaqueToken(value, digest(bytes));
    }

    @Override
    public byte[] hash(String rawToken) {
        try {
            byte[] decoded = Base64.getUrlDecoder().decode(rawToken);
            return digest(decoded);
        } catch (IllegalArgumentException exception) {
            return digest(rawToken.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        }
    }

    private byte[] digest(byte[] value) {
        try {
            return MessageDigest.getInstance("SHA-256").digest(value);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 is unavailable", exception);
        }
    }
}
