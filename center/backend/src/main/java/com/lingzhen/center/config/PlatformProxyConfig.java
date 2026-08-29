package com.lingzhen.center.config;

import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.net.http.HttpClient;
import java.time.Duration;

@Configuration
@EnableConfigurationProperties(PlatformProxyProperties.class)
public class PlatformProxyConfig {

    @Bean
    HttpClient platformProxyHttpClient(PlatformProxyProperties properties) {
        int seconds = Math.max(1, Math.min(60, properties.getConnectTimeoutSeconds()));
        return HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(seconds))
                .followRedirects(HttpClient.Redirect.NEVER)
                .build();
    }
}
