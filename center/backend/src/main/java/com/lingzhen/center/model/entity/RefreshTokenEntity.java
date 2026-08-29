package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "refresh_tokens", schema = "identity")
public class RefreshTokenEntity {

    @Id
    private UUID id;

    @Column(name = "session_id")
    private UUID sessionId;

    @Column(name = "family_id")
    private UUID familyId;

    @Column(name = "parent_token_id")
    private UUID parentTokenId;

    @Column(name = "token_hash")
    private byte[] tokenHash;

    private String status;

    @Column(name = "issued_at")
    private Instant issuedAt;

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

    protected RefreshTokenEntity() {
    }

    public RefreshTokenEntity(
            UUID id,
            UUID sessionId,
            UUID familyId,
            UUID parentTokenId,
            byte[] tokenHash,
            Instant issuedAt,
            Instant expiresAt
    ) {
        this.id = id;
        this.sessionId = sessionId;
        this.familyId = familyId;
        this.parentTokenId = parentTokenId;
        this.tokenHash = tokenHash.clone();
        this.status = "active";
        this.issuedAt = issuedAt;
        this.expiresAt = expiresAt;
        this.createdAt = issuedAt;
        this.updatedAt = issuedAt;
    }

    public void rotate(Instant now) {
        status = "rotated";
        consumedAt = now;
        updatedAt = now;
    }

    public void reuse(Instant now, String reason) {
        status = "reused";
        if (consumedAt == null) {
            consumedAt = now;
        }
        revokedAt = now;
        revokeReason = reason;
        updatedAt = now;
    }

    public void revoke(Instant now, String reason) {
        if ("active".equals(status)) {
            status = "revoked";
            revokedAt = now;
            revokeReason = reason;
            updatedAt = now;
        }
    }

    public UUID id() {
        return id;
    }

    public UUID sessionId() {
        return sessionId;
    }

    public UUID familyId() {
        return familyId;
    }

    public String status() {
        return status;
    }

    public Instant expiresAt() {
        return expiresAt;
    }
}
