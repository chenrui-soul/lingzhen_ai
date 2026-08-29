package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenant_invitations", schema = "identity")
public class TenantInvitationEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "target_email")
    private String targetEmail;

    @Column(name = "role_id")
    private UUID roleId;

    @Column(name = "role_scope")
    private String roleScope;

    @Column(name = "token_hash")
    private byte[] tokenHash;

    private String status;

    @Column(name = "invited_by_membership_id")
    private UUID invitedByMembershipId;

    @Column(name = "accepted_by_membership_id")
    private UUID acceptedByMembershipId;

    @Column(name = "expires_at")
    private Instant expiresAt;

    @Column(name = "accepted_at")
    private Instant acceptedAt;

    @Column(name = "revoked_at")
    private Instant revokedAt;

    @Column(name = "revoke_reason")
    private String revokeReason;

    @Column(name = "idempotency_key")
    private String idempotencyKey;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;

    protected TenantInvitationEntity() {
    }

    public void accept(UUID membershipId, Instant now) {
        status = "accepted";
        acceptedByMembershipId = membershipId;
        acceptedAt = now;
        updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public UUID tenantId() {
        return tenantId;
    }

    public String targetEmail() {
        return targetEmail;
    }

    public UUID roleId() {
        return roleId;
    }

    public String status() {
        return status;
    }

    public Instant expiresAt() {
        return expiresAt;
    }
}
