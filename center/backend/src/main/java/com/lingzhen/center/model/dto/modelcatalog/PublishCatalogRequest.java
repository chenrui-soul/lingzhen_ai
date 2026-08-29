package com.lingzhen.center.model.dto.modelcatalog;

import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.NotBlank;

public record PublishCatalogRequest(
        @Positive Long expectedCurrentVersion,
        @NotBlank @Pattern(regexp = "^[0-9a-f]{64}$") String expectedContentHash
) {
}
