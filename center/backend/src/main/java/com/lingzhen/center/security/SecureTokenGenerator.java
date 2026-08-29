package com.lingzhen.center.security;

public interface SecureTokenGenerator {

    OpaqueToken generate();

    byte[] hash(String rawToken);

    record OpaqueToken(String value, byte[] hash) {
    }
}
