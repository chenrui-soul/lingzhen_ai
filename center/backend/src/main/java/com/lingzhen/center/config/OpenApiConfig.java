package com.lingzhen.center.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class OpenApiConfig {

    @Bean
    OpenAPI lingzhenCenterOpenApi() {
        return new OpenAPI().info(new Info()
                .title("Lingzhen Center API")
                .description("灵帧联网中心后端接口")
                .version("0.1.0"));
    }
}

