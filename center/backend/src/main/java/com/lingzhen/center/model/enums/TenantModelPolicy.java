package com.lingzhen.center.model.enums;

import java.util.Arrays;

public enum TenantModelPolicy {
    INHERIT("inherit"),
    ENABLED("enabled"),
    HIDDEN("hidden");

    private final String value;

    TenantModelPolicy(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public static TenantModelPolicy fromValue(String value) {
        return Arrays.stream(values())
                .filter(item -> item.value.equals(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported tenant model policy"));
    }
}
