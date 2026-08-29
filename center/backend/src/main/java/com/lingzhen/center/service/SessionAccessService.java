package com.lingzhen.center.service;

import com.lingzhen.center.model.dto.auth.SessionClaims;
import com.lingzhen.center.model.dto.auth.SessionContext;

import java.util.Optional;

public interface SessionAccessService {

    Optional<SessionContext> verify(SessionClaims claims);
}
