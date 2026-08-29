package com.lingzhen.center.service.impl;

import com.lingzhen.center.repository.HealthRepository;
import com.lingzhen.center.service.HealthService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class HealthServiceImpl implements HealthService {

    private static final Logger log = LoggerFactory.getLogger(HealthServiceImpl.class);

    private final HealthRepository healthRepository;

    public HealthServiceImpl(HealthRepository healthRepository) {
        this.healthRepository = healthRepository;
    }

    @Override
    public boolean isReady() {
        try {
            return healthRepository.isDatabaseReady();
        } catch (RuntimeException exception) {
            log.warn("Database readiness check failed");
            return false;
        }
    }
}
