package com.lingzhen.center.config;

import org.springframework.context.ApplicationContextException;
import org.springframework.context.ApplicationContextInitializer;
import org.springframework.context.ConfigurableApplicationContext;

public final class FixedPortContract
        implements ApplicationContextInitializer<ConfigurableApplicationContext> {

    public static final int REQUIRED_PORT = 9001;

    @Override
    public void initialize(ConfigurableApplicationContext applicationContext) {
        int configuredPort = applicationContext.getEnvironment()
                .getProperty("server.port", Integer.class, REQUIRED_PORT);

        if (configuredPort != REQUIRED_PORT) {
            throw new ApplicationContextException(
                    "server.port must remain fixed at " + REQUIRED_PORT
            );
        }
    }
}

