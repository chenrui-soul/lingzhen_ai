package com.lingzhen.center.service.impl;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class JavaHttpPlatformProviderClientTest {
    @Test
    void usesCompleteConfiguredUrlWithoutAppendingBaseUrl() {
        assertThat(JavaHttpPlatformProviderClient.endpoint(
                "https://gateway.example.com/submit",
                "https://gateway.example.com/tasks/job-1"))
                .hasToString("https://gateway.example.com/tasks/job-1");
    }

    @Test
    void appendsRelativeConfiguredPathToBaseUrl() {
        assertThat(JavaHttpPlatformProviderClient.endpoint(
                "https://gateway.example.com/api",
                "/tasks/job-1"))
                .hasToString("https://gateway.example.com/api/tasks/job-1");
    }
}
