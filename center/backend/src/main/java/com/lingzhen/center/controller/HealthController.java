package com.lingzhen.center.controller;

import com.lingzhen.center.model.dto.common.HealthResponse;
import com.lingzhen.center.service.HealthService;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/health")
public class HealthController {

    private static final String SERVICE_NAME = "lingzhen-center-backend";
    private static final int SERVICE_PORT = 9001;

    private final HealthService healthService;

    public HealthController(HealthService healthService) {
        this.healthService = healthService;
    }

    @GetMapping("/live")
    public HealthResponse live() {
        return response("UP");
    }

    @GetMapping("/ready")
    public ResponseEntity<HealthResponse> ready() {
        if (healthService.isReady()) {
            return ResponseEntity.ok(response("UP"));
        }
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(response("DOWN"));
    }

    private HealthResponse response(String status) {
        return new HealthResponse(status, SERVICE_NAME, SERVICE_PORT);
    }
}
