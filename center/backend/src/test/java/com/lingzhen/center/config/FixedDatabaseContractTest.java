package com.lingzhen.center.config;

import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContextException;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FixedDatabaseContractTest {

    private final FixedDatabaseContract contract = new FixedDatabaseContract();

    @Test
    void shouldAcceptRequiredDatabaseConfiguration() {
        GenericApplicationContext context = contextWith(
                FixedDatabaseContract.REQUIRED_URL,
                FixedDatabaseContract.REQUIRED_USERNAME
        );

        assertThatCode(() -> contract.initialize(context)).doesNotThrowAnyException();
    }

    @Test
    void shouldDefaultToRequiredDatabaseConfigurationWhenPropertiesAreMissing() {
        GenericApplicationContext context = new GenericApplicationContext();
        context.setEnvironment(new MockEnvironment());

        assertThatCode(() -> contract.initialize(context)).doesNotThrowAnyException();
    }

    @Test
    void shouldRejectAnotherDatabaseEndpoint() {
        GenericApplicationContext context = contextWith(
                "jdbc:postgresql://127.0.0.1:5432/lingframe_identity",
                FixedDatabaseContract.REQUIRED_USERNAME
        );

        assertThatThrownBy(() -> contract.initialize(context))
                .isInstanceOf(ApplicationContextException.class)
                .hasMessageContaining("spring.datasource.url must remain fixed");
    }

    @Test
    void shouldRejectAnotherDatabaseUsername() {
        GenericApplicationContext context = contextWith(
                FixedDatabaseContract.REQUIRED_URL,
                "postgres"
        );

        assertThatThrownBy(() -> contract.initialize(context))
                .isInstanceOf(ApplicationContextException.class)
                .hasMessage("spring.datasource.username must remain fixed at lingframe_app");
    }

    private GenericApplicationContext contextWith(String url, String username) {
        GenericApplicationContext context = new GenericApplicationContext();
        context.setEnvironment(new MockEnvironment()
                .withProperty("spring.datasource.url", url)
                .withProperty("spring.datasource.username", username));
        return context;
    }
}
