package com.lingzhen.center.config;

import org.springframework.context.ApplicationContextException;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

public final class FixedDatabaseContract
        implements ApplicationContextInitializer<ConfigurableApplicationContext> {

    public static final String REQUIRED_URL =
            "jdbc:postgresql://127.0.0.1:5433/lingframe_identity";
    public static final String REQUIRED_USERNAME = "lingframe_app";

    @Override
    public void initialize(ConfigurableApplicationContext applicationContext) {
        String configuredUrl = applicationContext.getEnvironment()
                .getProperty("spring.datasource.url", REQUIRED_URL);
        String configuredUsername = applicationContext.getEnvironment()
                .getProperty("spring.datasource.username", REQUIRED_USERNAME);

        if (!REQUIRED_URL.equals(configuredUrl)) {
            throw new ApplicationContextException(
                    "spring.datasource.url must remain fixed at " + REQUIRED_URL
            );
        }

        if (!REQUIRED_USERNAME.equals(configuredUsername)) {
            throw new ApplicationContextException(
                    "spring.datasource.username must remain fixed at " + REQUIRED_USERNAME
            );
        }
    }
}
