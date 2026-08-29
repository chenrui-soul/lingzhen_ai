package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "tenants", schema = "identity")
public class TenantEntity {

    @Id
    private UUID id;

    @Column(name = "tenant_code")
    private String tenantCode;

    @Column(name = "display_name")
    private String displayName;

    private String status;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;

    protected TenantEntity() {
    }

    public TenantEntity(UUID id, String tenantCode, String displayName, Instant now) {
        this.id = id;
        this.tenantCode = tenantCode;
        this.displayName = displayName;
        this.status = "active";
        this.createdAt = now;
        this.updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public String tenantCode() {
        return tenantCode;
    }

    public String displayName() {
        return displayName;
    }

    public String status() {
        return status;
    }
}
