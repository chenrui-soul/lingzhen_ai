package com.lingzhen.center.service.impl;

import com.lingzhen.center.exception.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@Component
public class ModelCatalogContractValidator {

    static final int MAX_CONTRACT_DEPTH = 12;
    static final int MAX_CONTRACT_ARRAY_ITEMS = 1000;
    static final int MAX_CONTRACT_OBJECT_KEYS = 200;
    static final int MAX_CONTRACT_BYTES = 64 * 1024;

    private static final Set<String> FORBIDDEN_KEYS = Set.of(
            "apikey",
            "authorization",
            "baseurl",
            "constructor",
            "credential",
            "credentialref",
            "customheaders",
            "databaseurl",
            "headers",
            "privateheaders",
            "proto",
            "prototype",
            "secret",
            "token"
    );

    private final ObjectMapper objectMapper;

    public ModelCatalogContractValidator(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public ValidatedContract validate(
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters
    ) {
        validateRoot(parameterSchema, "parameterSchema");
        validateRoot(defaultParameters, "defaultParameters");
        validateSchemaShape(parameterSchema);
        return new ValidatedContract(
                immutableMap(parameterSchema),
                immutableMap(defaultParameters)
        );
    }

    private void validateRoot(Map<String, Object> value, String fieldName) {
        if (value == null) {
            throw invalid(fieldName + " 必须是 JSON 对象");
        }
        validateNode(value, 1);
        try {
            if (objectMapper.writeValueAsBytes(value).length > MAX_CONTRACT_BYTES) {
                throw invalid(fieldName + " 不能超过 64 KiB");
            }
        } catch (JacksonException exception) {
            throw invalid(fieldName + " 不是有效的 JSON 对象");
        }
    }

    private void validateSchemaShape(Map<String, Object> parameterSchema) {
        Object type = parameterSchema.get("type");
        if (type != null && !(type instanceof String value && "object".equals(value))) {
            throw invalid("parameterSchema.type 只能是 object");
        }
        Object properties = parameterSchema.get("properties");
        if (properties != null && !(properties instanceof Map<?, ?>)) {
            throw invalid("parameterSchema.properties 必须是 JSON 对象");
        }
    }

    private void validateNode(Object value, int depth) {
        if (depth > MAX_CONTRACT_DEPTH) {
            throw invalid("参数结构嵌套不能超过 12 层");
        }
        if (value == null || value instanceof String || value instanceof Boolean) {
            return;
        }
        if (value instanceof Double number && !Double.isFinite(number)) {
            throw invalid("参数结构不能包含非有限数值");
        }
        if (value instanceof Float number && !Float.isFinite(number)) {
            throw invalid("参数结构不能包含非有限数值");
        }
        if (value instanceof Number) {
            return;
        }
        if (value instanceof Map<?, ?> map) {
            if (map.size() > MAX_CONTRACT_OBJECT_KEYS) {
                throw invalid("单个参数对象不能超过 200 个字段");
            }
            for (Map.Entry<?, ?> entry : map.entrySet()) {
                if (!(entry.getKey() instanceof String key) || key.isBlank()) {
                    throw invalid("参数对象字段名必须是非空字符串");
                }
                if (FORBIDDEN_KEYS.contains(normalizeKey(key))) {
                    throw invalid("参数结构包含不允许的敏感字段");
                }
                validateNode(entry.getValue(), depth + 1);
            }
            return;
        }
        if (value instanceof List<?> list) {
            if (list.size() > MAX_CONTRACT_ARRAY_ITEMS) {
                throw invalid("单个参数数组不能超过 1000 项");
            }
            for (Object item : list) {
                validateNode(item, depth + 1);
            }
            return;
        }
        throw invalid("参数结构包含不支持的值类型");
    }

    private String normalizeKey(String key) {
        return key.replaceAll("[^A-Za-z0-9]", "")
                .toLowerCase(Locale.ROOT);
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> immutableMap(Map<String, Object> source) {
        return (Map<String, Object>) immutableValue(source);
    }

    private Object immutableValue(Object value) {
        if (value instanceof Map<?, ?> map) {
            Map<String, Object> copy = new LinkedHashMap<>();
            map.forEach((key, item) -> copy.put((String) key, immutableValue(item)));
            return Collections.unmodifiableMap(copy);
        }
        if (value instanceof List<?> list) {
            List<Object> copy = new ArrayList<>(list.size());
            list.forEach(item -> copy.add(immutableValue(item)));
            return Collections.unmodifiableList(copy);
        }
        return value;
    }

    private ApiException invalid(String message) {
        return new ApiException(HttpStatus.BAD_REQUEST, "MODEL_SCHEMA_INVALID", message);
    }

    public record ValidatedContract(
            Map<String, Object> parameterSchema,
            Map<String, Object> defaultParameters
    ) {
    }
}
