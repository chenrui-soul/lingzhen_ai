package com.lingzhen.center.service.impl;

import com.lingzhen.center.service.PlatformProviderClient;
import org.springframework.stereotype.Component;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.ObjectMapper;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.Map;

@Component
public class JavaHttpPlatformProviderClient implements PlatformProviderClient {
    private final HttpClient httpClient;
    private final ObjectMapper objectMapper;

    public JavaHttpPlatformProviderClient(HttpClient httpClient, ObjectMapper objectMapper) {
        this.httpClient = httpClient;
        this.objectMapper = objectMapper;
    }

    @Override
    public ProviderResponse submit(ProviderRequest request) {
        return exchange(request, "POST", request.body());
    }

    @Override
    public ProviderResponse status(ProviderRequest request) {
        return exchange(request, "GET", null);
    }

    @Override
    public ProviderResponse cancel(ProviderRequest request) {
        return exchange(request, "POST", request.body());
    }

    private ProviderResponse exchange(ProviderRequest request, String method, Map<String, Object> body) {
        try {
            URI uri = endpoint(request.baseUrl(), request.path());
            HttpRequest.Builder builder = HttpRequest.newBuilder(uri)
                    .timeout(Duration.ofSeconds(Math.max(5, Math.min(600, request.timeoutSeconds()))))
                    .header("Accept", "application/json")
                    .header("User-Agent", "LingFrameAI-Center/1");
            if (request.apiKey() != null && !request.apiKey().isBlank()) {
                builder.header("Authorization", "Bearer " + request.apiKey());
            }
            if ("GET".equals(method)) {
                builder.GET();
            } else {
                String json = objectMapper.writeValueAsString(body == null ? Map.of() : body);
                builder.header("Content-Type", "application/json");
                builder.method(method, HttpRequest.BodyPublishers.ofString(json));
            }
            HttpResponse<String> response = httpClient.send(builder.build(), HttpResponse.BodyHandlers.ofString());
            Map<String, Object> parsed = parseObject(response.body());
            String error = response.statusCode() >= 200 && response.statusCode() < 300
                    ? ""
                    : safeProviderError(parsed, response.statusCode());
            return new ProviderResponse(true, response.statusCode() >= 200 && response.statusCode() < 300,
                    response.statusCode(), parsed, error);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            return new ProviderResponse(false, false, 0, Map.of(), "平台模型服务请求被中断");
        } catch (Exception exception) {
            return new ProviderResponse(false, false, 0, Map.of(), "平台模型服务暂时不可用");
        }
    }

    private URI endpoint(String baseUrl, String requestPath) {
        URI base = URI.create(baseUrl);
        if (!"http".equalsIgnoreCase(base.getScheme()) && !"https".equalsIgnoreCase(base.getScheme())) {
            throw new IllegalArgumentException("平台模型服务地址协议无效");
        }
        String basePath = base.getPath() == null ? "" : base.getPath().replaceAll("/+$", "");
        String path = requestPath == null ? "" : requestPath.trim();
        if (!path.startsWith("/")) path = "/" + path;
        return URI.create(base.getScheme() + "://" + base.getAuthority() + basePath + path);
    }

    private Map<String, Object> parseObject(String raw) {
        if (raw == null || raw.isBlank()) return Map.of();
        try {
            Map<String, Object> parsed = objectMapper.readValue(raw, Map.class);
            return parsed == null ? Map.of() : new LinkedHashMap<>(parsed);
        } catch (JacksonException | ClassCastException exception) {
            return Map.of();
        }
    }

    private String safeProviderError(Map<String, Object> body, int status) {
        Object error = body.get("error");
        if (error instanceof Map<?, ?> map && map.get("message") != null) {
            String message = String.valueOf(map.get("message")).replaceAll("[\\r\\n]", " ");
            return message.substring(0, Math.min(300, message.length()));
        }
        if (body.get("message") != null) {
            String message = String.valueOf(body.get("message")).replaceAll("[\\r\\n]", " ");
            return message.substring(0, Math.min(300, message.length()));
        }
        return "平台模型服务返回 HTTP " + status;
    }
}
