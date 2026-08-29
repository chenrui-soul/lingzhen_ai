package com.lingzhen.center.model.enums;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonValue;

import java.util.Arrays;

public enum ClientType {
    DESKTOP("desktop"),
    MANAGEMENT_WEB("management_web");

    private final String value;

    ClientType(String value) {
        this.value = value;
    }

    @JsonCreator
    public static ClientType fromValue(String value) {
        return Arrays.stream(values())
                .filter(candidate -> candidate.value.equalsIgnoreCase(value))
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("Unsupported client type"));
    }

    @JsonValue
    public String value() {
        return value;
    }
}
