package com.lingzhen.center.controller;

import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.model.dto.auth.SessionContext;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionDetailResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogVersionPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishPreviewResponse;
import com.lingzhen.center.model.dto.modelcatalog.CatalogPublishResponse;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.CreateModelRequest;
import com.lingzhen.center.model.dto.modelcatalog.ModelPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderPageResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelProviderResponse;
import com.lingzhen.center.model.dto.modelcatalog.ModelResponse;
import com.lingzhen.center.model.dto.modelcatalog.PublishCatalogRequest;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelProviderRequest;
import com.lingzhen.center.model.dto.modelcatalog.UpdateModelRequest;
import com.lingzhen.center.service.ModelCatalogCommandService;
import com.lingzhen.center.service.ModelCatalogQueryService;
import com.lingzhen.center.service.CatalogPublicationService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

@RestController
@RequestMapping("/api/v1/management/model-catalog")
public class ModelCatalogController {

    private final ModelCatalogQueryService queryService;
    private final ModelCatalogCommandService commandService;
    private final CatalogPublicationService publicationService;

    public ModelCatalogController(
            ModelCatalogQueryService queryService,
            ModelCatalogCommandService commandService,
            CatalogPublicationService publicationService
    ) {
        this.queryService = queryService;
        this.commandService = commandService;
        this.publicationService = publicationService;
    }

    @GetMapping("/providers")
    @PreAuthorize("hasAuthority('PERM_model_catalog.read')")
    public ModelProviderPageResponse providers(
            Authentication authentication,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize
    ) {
        return queryService.providers(sessionAccess(authentication), page, pageSize);
    }

    @PostMapping("/providers")
    @PreAuthorize("hasAuthority('PERM_model_catalog.manage')")
    public ResponseEntity<ModelProviderResponse> createProvider(
            Authentication authentication,
            @Valid @RequestBody CreateModelProviderRequest request
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(
                commandService.createProvider(sessionAccess(authentication), request)
        );
    }

    @PutMapping("/providers/{providerId}")
    @PreAuthorize("hasAuthority('PERM_model_catalog.manage')")
    public ModelProviderResponse updateProvider(
            Authentication authentication,
            @PathVariable UUID providerId,
            @Valid @RequestBody UpdateModelProviderRequest request
    ) {
        return commandService.updateProvider(sessionAccess(authentication), providerId, request);
    }

    @GetMapping("/models")
    @PreAuthorize("hasAuthority('PERM_model_catalog.read')")
    public ModelPageResponse models(
            Authentication authentication,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize,
            @RequestParam(required = false) String keyword,
            @RequestParam(defaultValue = "all") String status,
            @RequestParam(defaultValue = "all") String capabilityType,
            @RequestParam(required = false) UUID providerId
    ) {
        return queryService.models(
                sessionAccess(authentication),
                page,
                pageSize,
                keyword,
                status,
                capabilityType,
                providerId
        );
    }

    @PostMapping("/models")
    @PreAuthorize("hasAuthority('PERM_model_catalog.manage')")
    public ResponseEntity<ModelResponse> createModel(
            Authentication authentication,
            @Valid @RequestBody CreateModelRequest request
    ) {
        return ResponseEntity.status(HttpStatus.CREATED).body(
                commandService.createModel(sessionAccess(authentication), request)
        );
    }

    @PutMapping("/models/{modelId}")
    @PreAuthorize("hasAuthority('PERM_model_catalog.manage')")
    public ModelResponse updateModel(
            Authentication authentication,
            @PathVariable UUID modelId,
            @Valid @RequestBody UpdateModelRequest request
    ) {
        return commandService.updateModel(sessionAccess(authentication), modelId, request);
    }

    @GetMapping("/versions")
    @PreAuthorize("hasAuthority('PERM_model_catalog.read')")
    public CatalogVersionPageResponse versions(
            Authentication authentication,
            @RequestParam(defaultValue = "1") int page,
            @RequestParam(defaultValue = "20") int pageSize
    ) {
        return queryService.versions(sessionAccess(authentication), page, pageSize);
    }

    @GetMapping("/versions/{versionId}")
    @PreAuthorize("hasAuthority('PERM_model_catalog.read')")
    public CatalogVersionDetailResponse version(
            Authentication authentication,
            @PathVariable UUID versionId
    ) {
        return queryService.version(sessionAccess(authentication), versionId);
    }

    @GetMapping("/publish-preview")
    @PreAuthorize("hasAuthority('PERM_model_catalog.publish')")
    public CatalogPublishPreviewResponse publishPreview(Authentication authentication) {
        return publicationService.preview(sessionAccess(authentication));
    }

    @PostMapping("/versions/publish")
    @PreAuthorize("hasAuthority('PERM_model_catalog.publish')")
    public ResponseEntity<CatalogPublishResponse> publish(
            Authentication authentication,
            @RequestHeader(name = "Idempotency-Key") String idempotencyKey,
            @Valid @RequestBody PublishCatalogRequest request
    ) {
        CatalogPublishResponse response = publicationService.publish(
                sessionAccess(authentication),
                idempotencyKey,
                request
        );
        return ResponseEntity.status(
                response.idempotentReplay() ? HttpStatus.OK : HttpStatus.CREATED
        ).body(response);
    }

    private SessionContext sessionAccess(Authentication authentication) {
        if (authentication == null
                || !(authentication.getDetails() instanceof SessionContext access)) {
            throw new ApiException(
                    HttpStatus.UNAUTHORIZED,
                    "AUTHENTICATION_REQUIRED",
                    "登录会话无效或已过期"
            );
        }
        return access;
    }
}
