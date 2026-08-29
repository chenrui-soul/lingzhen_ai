package com.lingzhen.center.service;

import java.util.Map;

public interface PlatformProviderClient {
    ProviderResponse submit(ProviderRequest request);
    ProviderResponse status(ProviderRequest request);
    ProviderResponse cancel(ProviderRequest request);

    record ProviderRequest(
            String baseUrl,
            String apiKey,
            String path,
            String providerJobId,
            Map<String, Object> body,
            int timeoutSeconds
    ) { }

    record ProviderResponse(
            boolean transportOk,
            boolean httpOk,
            int httpStatus,
            Map<String, Object> body,
            String errorMessage
    ) { }
}
