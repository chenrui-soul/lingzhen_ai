package com.lingzhen.center.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "app.storage.minio")
public class MinioStorageProperties {
    private boolean enabled = true;
    private String endpoint = "http://127.0.0.1:9100";
    private String accessKey = "";
    private String secretKey = "";
    private String bucket = "lingframe-assets";
    private int presignMinutes = 30;

    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean enabled) { this.enabled = enabled; }
    public String getEndpoint() { return endpoint; }
    public void setEndpoint(String endpoint) { this.endpoint = endpoint; }
    public String getAccessKey() { return accessKey; }
    public void setAccessKey(String accessKey) { this.accessKey = accessKey; }
    public String getSecretKey() { return secretKey; }
    public void setSecretKey(String secretKey) { this.secretKey = secretKey; }
    public String getBucket() { return bucket; }
    public void setBucket(String bucket) { this.bucket = bucket; }
    public int getPresignMinutes() { return presignMinutes; }
    public void setPresignMinutes(int presignMinutes) { this.presignMinutes = presignMinutes; }
}
