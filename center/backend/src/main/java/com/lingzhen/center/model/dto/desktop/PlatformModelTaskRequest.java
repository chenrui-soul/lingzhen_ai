package com.lingzhen.center.model.dto.desktop;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.List;
import java.util.LinkedHashMap;
import java.util.Collections;
import java.util.Map;
import java.util.UUID;

public record PlatformModelTaskRequest(
        UUID modelId,
        @NotBlank @Size(max = 32) String creationType,
        @NotBlank @Size(max = 20000) String prompt,
        Map<String, Object> parameters,
        List<AssetReference> assets,
        @Size(max = 128) String clientRequestId
) {
    public PlatformModelTaskRequest {
        parameters = parameters == null ? Map.of() : Collections.unmodifiableMap(new LinkedHashMap<>(parameters));
        assets = assets == null ? List.of() : List.copyOf(assets);
    }

    public record AssetReference(
            @Size(max = 128) String id,
            @NotBlank @Size(max = 16) String type,
            @NotBlank @Size(max = 8192) String url
    ) { }
}
