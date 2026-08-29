package com.lingzhen.center.integration;

import org.flywaydb.core.Flyway;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.Statement;
import java.util.Base64;

abstract class PostgreSqlIdentityTestSupport {

    static final String OWNER_PASSWORD = "owner-test-password";
    static final String APP_PASSWORD = "app-test-password";

    static final PostgreSQLContainer<?> POSTGRES = new PostgreSQLContainer<>("postgres:16-alpine")
            .withDatabaseName("lingframe_identity")
            .withUsername("lingframe_owner")
            .withPassword(OWNER_PASSWORD);

    static {
        POSTGRES.start();
        prepareDatabase();
    }

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", POSTGRES::getJdbcUrl);
        registry.add("spring.datasource.username", () -> "lingframe_app");
        registry.add("spring.datasource.password", () -> APP_PASSWORD);
        registry.add("spring.flyway.enabled", () -> "false");
        registry.add("app.auth.hmac-secret", () -> Base64.getEncoder().encodeToString(
                "lingzhen-integration-test-hmac-key-32-bytes".getBytes(java.nio.charset.StandardCharsets.UTF_8)
        ));
        registry.add("app.auth.secure-cookies", () -> "false");
    }

    private static void prepareDatabase() {
        try (Connection connection = DriverManager.getConnection(
                POSTGRES.getJdbcUrl(),
                POSTGRES.getUsername(),
                POSTGRES.getPassword()
        ); Statement statement = connection.createStatement()) {
            statement.execute("CREATE ROLE lingframe_app LOGIN PASSWORD '" + APP_PASSWORD + "'");
            statement.execute("CREATE SCHEMA identity AUTHORIZATION lingframe_owner");
            statement.execute("GRANT USAGE ON SCHEMA identity TO lingframe_app");
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }

        Flyway.configure()
                .dataSource(POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword())
                .schemas("identity")
                .defaultSchema("identity")
                .locations("classpath:db/migration")
                .load()
                .migrate();
    }
}
