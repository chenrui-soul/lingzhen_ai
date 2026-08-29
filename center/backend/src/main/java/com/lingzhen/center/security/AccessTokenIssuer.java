package com.lingzhen.center.security;

import com.lingzhen.center.model.dto.auth.SessionContext;

import java.time.Instant;

public interface AccessTokenIssuer {

    IssuedAccessToken issue(SessionContext access, Instant now);

    record IssuedAccessToken(String value, Instant expiresAt) {
    }
}
