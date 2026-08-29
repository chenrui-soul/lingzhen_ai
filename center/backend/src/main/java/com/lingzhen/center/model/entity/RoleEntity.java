package com.lingzhen.center.model.entity;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import java.util.UUID;

@Entity
@Table(name = "roles", schema = "identity")
public class RoleEntity {

    @Id
    private UUID id;

    private String code;

    private String roleScope;

    protected RoleEntity() {
    }

    public UUID id() {
        return id;
    }

    public String code() {
        return code;
    }

    public String roleScope() {
        return roleScope;
    }
}
