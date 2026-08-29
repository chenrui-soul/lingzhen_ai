package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "devices", schema = "identity")
public class DeviceEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "client_type")
    private String clientType;

    @Column(name = "device_hash")
    private String deviceHash;

    @Column(name = "fingerprint_version")
    private short fingerprintVersion;

    @Column(name = "display_name")
    private String displayName;

    private String platform;
    private String architecture;

    @Column(name = "app_version")
    private String appVersion;

    @Column(name = "trust_status")
    private String trustStatus;

    @Column(name = "first_seen_at")
    private Instant firstSeenAt;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Column(name = "blocked_at")
    private Instant blockedAt;

    @Column(name = "blocked_reason")
    private String blockedReason;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;

    protected DeviceEntity() {
    }

    public DeviceEntity(
            UUID id,
            UUID tenantId,
            String clientType,
            String deviceHash,
            short fingerprintVersion,
            String displayName,
            String platform,
            String architecture,
            String appVersion,
            Instant now
    ) {
        this.id = id;
        this.tenantId = tenantId;
        this.clientType = clientType;
        this.deviceHash = deviceHash;
        this.fingerprintVersion = fingerprintVersion;
        this.displayName = displayName;
        this.platform = platform;
        this.architecture = architecture;
        this.appVersion = appVersion;
        this.trustStatus = "unknown";
        this.firstSeenAt = now;
        this.lastSeenAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void seen(
            short newFingerprintVersion,
            String newDisplayName,
            String newPlatform,
            String newArchitecture,
            String newAppVersion,
            Instant now
    ) {
        fingerprintVersion = newFingerprintVersion;
        displayName = newDisplayName;
        platform = newPlatform;
        architecture = newArchitecture;
        appVersion = newAppVersion;
        lastSeenAt = now;
        updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public String trustStatus() {
        return trustStatus;
    }

    public UUID tenantId() {
        return tenantId;
    }

    public String clientType() {
        return clientType;
    }
}
