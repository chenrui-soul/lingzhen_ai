package com.lingzhen.center.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/** Backend-only global configuration for the platform model proxy. */
@ConfigurationProperties(prefix = "app.platform-proxy")
public class PlatformProxyProperties {

    private boolean enabled = true;
    private int connectTimeoutSeconds = 10;
    private int defaultTimeoutSeconds = 120;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public int getConnectTimeoutSeconds() { return connectTimeoutSeconds; }
    public void setConnectTimeoutSeconds(int value) { this.connectTimeoutSeconds = value; }
    public int getDefaultTimeoutSeconds() { return defaultTimeoutSeconds; }
    public void setDefaultTimeoutSeconds(int value) { this.defaultTimeoutSeconds = value; }
}
