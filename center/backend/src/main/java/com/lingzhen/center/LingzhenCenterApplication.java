package com.lingzhen.center;

import com.lingzhen.center.config.FixedDatabaseContract;
import com.lingzhen.center.config.FixedPortContract;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.context.properties.ConfigurationPropertiesScan;

@SpringBootApplication
@ConfigurationPropertiesScan
public class LingzhenCenterApplication {

    public static void main(String[] args) {
        SpringApplication application = new SpringApplication(LingzhenCenterApplication.class);
        application.addInitializers(
                new FixedPortContract(),
                new FixedDatabaseContract()
        );
        application.run(args);
    }
}
