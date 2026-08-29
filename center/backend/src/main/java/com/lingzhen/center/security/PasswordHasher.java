package com.lingzhen.center.security;

public interface PasswordHasher {

    String hash(String rawPassword);

    boolean matches(String rawPassword, String encodedPassword);

    void consumeDummyVerification(String rawPassword);
}
