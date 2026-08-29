package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class ModelCatalogContractValidatorTest {

    private final ModelCatalogContractValidator validator =
            new ModelCatalogContractValidator(new ObjectMapper());

    @Test
    void acceptsSafeContractsAndReturnsImmutableCopies() {
        var result = validator.validate(
                Map.of(
                        "type", "object",
                        "properties", Map.of("duration", Map.of("type", "integer"))
                ),
                Map.of("duration", 10)
        );

        assertThat(result.parameterSchema()).containsEntry("type", "object");
        assertThatThrownBy(() -> result.defaultParameters().put("duration", 20))
                .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void rejectsSensitiveOversizedAndNonFiniteStructures() {
        assertInvalid(Map.of("type", "object"), Map.of("authorization", "secret"));
        assertInvalid(Map.of("type", "object", "properties", List.of()), Map.of());
        assertInvalid(Map.of("type", "object"), Map.of("temperature", Double.NaN));

        Map<String, Object> tooManyKeys = new LinkedHashMap<>();
        for (int index = 0; index <= ModelCatalogContractValidator.MAX_CONTRACT_OBJECT_KEYS; index++) {
            tooManyKeys.put("field" + index, index);
        }
        assertInvalid(tooManyKeys, Map.of());

        List<Object> tooManyItems = new ArrayList<>();
        for (int index = 0; index <= ModelCatalogContractValidator.MAX_CONTRACT_ARRAY_ITEMS; index++) {
            tooManyItems.add(index);
        }
        assertInvalid(Map.of("type", "object"), Map.of("values", tooManyItems));
        assertInvalid(
                Map.of("type", "object"),
                Map.of("value", "x".repeat(ModelCatalogContractValidator.MAX_CONTRACT_BYTES))
        );
    }

    private void assertInvalid(
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters
    ) {
        assertThatThrownBy(() -> validator.validate(parameterSchema, defaultParameters))
                .isInstanceOf(ApiException.class)
                .satisfies(exception -> {
                    ApiException apiException = (ApiException) exception;
                    assertThat(apiException.status().value()).isEqualTo(400);
                    assertThat(apiException.code()).isEqualTo("MODEL_SCHEMA_INVALID");
                });
    }
}
