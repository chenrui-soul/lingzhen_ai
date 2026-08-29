package com.lingzhen.center.model.enums;

import java.util.Arrays;
import java.util.Locale;
import java.util.Optional;

public enum ModelProviderProtocolFamily {
    OPENAI_COMPATIBLE("openai_compatible"),
    ANTHROPIC_COMPATIBLE("anthropic_compatible"),
    CUSTOM_PROXY("custom_proxy");

    private final String value;

    ModelProviderProtocolFamily(String value) {
        this.value = value;
    }

    public String value() {
        return value;
    }

    public static Optional<ModelProviderProtocolFamily> find(String value) {
        if (value == null || value.isBlank()) {
            return Optional.empty();
        }
        String normalized = value.trim().toLowerCase(Locale.ROOT);
        return Arrays.stream(values())
                .filter(item -> item.value.equals(normalized))
                .findFirst();
    }
}
