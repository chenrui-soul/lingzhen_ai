package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenant_selection_tickets", schema = "identity")
public class TenantSelectionTicketEntity {

    @Id
    private UUID id;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "token_hash")
    private byte[] tokenHash;

    @Column(name = "device_hash")
    private String deviceHash;

    @Column(name = "fingerprint_version")
    private short fingerprintVersion;

    @Column(name = "client_type")
    private String clientType;

    private String status;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "consumed_at")
    private Instant consumedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoke_reason")
    private String revokeReason;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    protected TenantSelectionTicketEntity() {
    }

    public TenantSelectionTicketEntity(
            UUID id,
            UUID userId,
            byte[] tokenHash,
            String deviceHash,
            short fingerprintVersion,
            String clientType,
            Instant expiresAt,
            Instant now
    ) {
        this.id = id;
        this.userId = userId;
        this.tokenHash = tokenHash.clone();
        this.deviceHash = deviceHash;
        this.fingerprintVersion = fingerprintVersion;
        this.clientType = clientType;
        this.status = "pending";
        this.expiresAt = expiresAt;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void consume(Instant now) {
        status = "consumed";
        consumedAt = now;
        updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public UUID userId() {
        return userId;
    }

    public String deviceHash() {
        return deviceHash;
    }

    public short fingerprintVersion() {
        return fingerprintVersion;
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
