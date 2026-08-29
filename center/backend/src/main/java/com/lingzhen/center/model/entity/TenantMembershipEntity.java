package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenant_memberships", schema = "identity")
public class TenantMembershipEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_id")
    private UUID tenantId;

    @Column(name = "user_id")
    private UUID userId;

    @Column(name = "role_id")
    private UUID roleId;

    @Column(name = "role_scope")
    private String roleScope;

    private String status;

    @Column(name = "joined_at")
    private Instant joinedAt;

    @Column(name = "removed_at")
    private Instant removedAt;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;

    protected TenantMembershipEntity() {
    }

    public TenantMembershipEntity(
            UUID id,
            UUID tenantId,
            UUID userId,
            UUID roleId,
            Instant now
    ) {
        this.id = id;
        this.tenantId = tenantId;
        this.userId = userId;
        this.roleId = roleId;
        this.roleScope = "tenant";
        this.status = "active";
        this.joinedAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public UUID tenantId() {
        return tenantId;
    }

    public UUID userId() {
        return userId;
    }

    public UUID roleId() {
        return roleId;
    }

    public String status() {
        return status;
    }
}
