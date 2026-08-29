package com.lingzhen.center.config;

import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContextException;
import org.springframework.context.support.GenericApplicationContext;
import org.springframework.mock.env.MockEnvironment;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class FixedPortContractTest {

    private final FixedPortContract contract = new FixedPortContract();

    @Test
    void shouldAcceptRequiredPort() {
        GenericApplicationContext context = contextWithPort("9001");

        assertThatCode(() -> contract.initialize(context)).doesNotThrowAnyException();
    }

    @Test
    void shouldDefaultToRequiredPortWhenPropertyIsMissing() {
        GenericApplicationContext context = new GenericApplicationContext();
        context.setEnvironment(new MockEnvironment());

        assertThatCode(() -> contract.initialize(context)).doesNotThrowAnyException();
    }

    @Test
    void shouldRejectAnyOtherPort() {
        GenericApplicationContext context = contextWithPort("9002");

        assertThatThrownBy(() -> contract.initialize(context))
                .isInstanceOf(ApplicationContextException.class)
                .hasMessage("server.port must remain fixed at 9001");
    }

    private GenericApplicationContext contextWithPort(String port) {
        GenericApplicationContext context = new GenericApplicationContext();
        context.setEnvironment(new MockEnvironment().withProperty("server.port", port));
        return context;
    }
}

