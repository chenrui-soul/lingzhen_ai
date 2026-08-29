package com.lingzhen.center.model.enums;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

public enum ModelCapabilityType {
    TEXT("text"),
    IMAGE("image"),
    VIDEO("video"),
    AUDIO("audio");

    private final String value;

    ModelCapabilityType(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public static Optional<ModelCapabilityType> find(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(item -> item.value.equals(normalized))
                .findFirst();
    }
}
