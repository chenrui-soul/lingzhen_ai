package com.lingzhen.center.repository;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;

public interface ModelPriceRepository {
    Optional<PriceRow> findActive(UUID modelId);
    PriceRow saveActive(SaveCommand command);

    record SaveCommand(
            UUID id,
            UUID modelId,
            String pricingUnit,
            long baseCredits,
            long maxReserveCredits,
            Map<String, Object> priceRule,
            UUID createdByUserId,
            Long expectedRowVersion
    ) {}

    record PriceRow(
            UUID id,
            UUID modelId,
            long version,
            String pricingUnit,
            long baseCredits,
            long maxReserveCredits,
            Map<String, Object> priceRule,
            long rowVersion
    ) {}
}
