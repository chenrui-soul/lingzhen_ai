package com.lingzhen.center.model.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import jakarta.persistence.Version;

import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users", schema = "identity")
public class UserEntity {

    @Id
    private UUID id;

    private String username;
    private String email;

    @Column(name = "password_hash", nullable = false)
    private String passwordHash;

    @Column(name = "password_algorithm", nullable = false)
    private String passwordAlgorithm;

    private String status;

    @Column(name = "failed_login_count")
    private int failedLoginCount;

    @Column(name = "locked_until")
    private Instant lockedUntil;

    @Column(name = "password_changed_at")
    private Instant passwordChangedAt;

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    @Column(name = "created_at")
    private Instant createdAt;

    @Column(name = "updated_at")
    private Instant updatedAt;

    @Version
    @Column(name = "row_version")
    private long rowVersion;

    protected UserEntity() {
    }

    public UserEntity(UUID id, String username, String email, String passwordHash, Instant now) {
        this.id = id;
        this.username = username;
        this.email = email;
        this.passwordHash = passwordHash;
        this.passwordAlgorithm = "argon2id";
        this.status = "active";
        this.failedLoginCount = 0;
        this.passwordChangedAt = now;
        this.createdAt = now;
        this.updatedAt = now;
    }

    public void recordSuccessfulLogin(Instant now) {
        status = "active";
        failedLoginCount = 0;
        lockedUntil = null;
        lastLoginAt = now;
        updatedAt = now;
    }

    public void recordFailedLogin(int failureCount, Instant newLockedUntil, Instant now) {
        failedLoginCount = failureCount;
        if (newLockedUntil != null) {
            status = "locked";
            lockedUntil = newLockedUntil;
        }
        updatedAt = now;
    }

    public void unlock(Instant now) {
        status = "active";
        failedLoginCount = 0;
        lockedUntil = null;
        updatedAt = now;
    }

    public UUID id() {
        return id;
    }

    public String username() {
        return username;
    }

    public String email() {
        return email;
    }

    public String passwordHash() {
        return passwordHash;
    }

    public String status() {
        return status;
    }

    public int failedLoginCount() {
        return failedLoginCount;
    }

    public Instant lockedUntil() {
        return lockedUntil;
    }
}
