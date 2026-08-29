package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_sessions", schema = "identity")
public class UserSessionEntity {

    @Id
    private UUID id;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "membership_id")
    private UUID membershipId;

    @Column(name = "device_id")
    private UUID deviceId;

    @Column(name = "client_type")
    private String clientType;

    private String status;

    @Column(name = "issued_at")
    private Instant issuedAt;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "last_seen_at")
    private Instant lastSeenAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoked_reason")
    private String revokedReason;

    @Column(name = "user_agent")
    private String userAgent;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;

    protected UserSessionEntity() {
    }

    public UserSessionEntity(
            UUID id,
            UUID userId,
            UUID tenantId,
            UUID membershipId,
            UUID deviceId,
            String clientType,
            Instant issuedAt,
            Instant expiresAt,
            String userAgent
    ) {
        this.id = id;
        this.userId = userId;
        this.tenantId = tenantId;
        this.membershipId = membershipId;
        this.deviceId = deviceId;
        this.clientType = clientType;
        this.status = "active";
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
        this.lastSeenAt = issuedAt;
        this.userAgent = userAgent;
        this.createdAt = issuedAt;
        this.updatedAt = issuedAt;
    }

    public void extend(Instant newExpiresAt, Instant now) {
        expiresAt = newExpiresAt;
        lastSeenAt = now;
        updatedAt = now;
    }

    public void revoke(Instant now, String reason) {
        if (!"revoked".equals(status)) {
            status = "revoked";
            revokedAt = now;
            revokedReason = reason;
            updatedAt = now;
        }
    }

    public UUID id() {
        return id;
    }

    public UUID userId() {
        return userId;
    }

    public UUID tenantId() {
        return tenantId;
    }

    public UUID membershipId() {
        return membershipId;
    }

    public UUID deviceId() {
        return deviceId;
    }

    public String clientType() {
        return clientType;
    }

    public String status() {
        return status;
    }

    public Instant expiresAt() {
        return expiresAt;
    }
}
