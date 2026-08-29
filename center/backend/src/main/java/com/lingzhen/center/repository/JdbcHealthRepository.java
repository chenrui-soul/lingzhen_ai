package com.lingzhen.center.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class JdbcHealthRepository implements HealthRepository {

    private static final String READINESS_QUERY = "SELECT 1";

    private final JdbcTemplate jdbcTemplate;

    public JdbcHealthRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    @Override
    public boolean isDatabaseReady() {
        Integer result = jdbcTemplate.queryForObject(READINESS_QUERY, Integer.class);
        return Integer.valueOf(1).equals(result);
    }
}
