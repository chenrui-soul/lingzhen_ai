package com.lingzhen.center.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;
import tools.jackson.databind.ObjectMapper;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ModelPricePersistenceAdapter implements ModelPriceRepository {
    private final NamedParameterJdbcTemplate jdbcTemplate;
    private final ObjectMapper objectMapper;

    public ModelPricePersistenceAdapter(NamedParameterJdbcTemplate jdbcTemplate, ObjectMapper objectMapper) {
        this.jdbcTemplate = jdbcTemplate;
        this.objectMapper = objectMapper;
    }

    @Override
    public Optional<PriceRow> findActive(UUID modelId) {
        return jdbcTemplate.query("""
                        SELECT id, model_id, version_no, pricing_unit, base_credits,
                               max_reserve_credits, price_rule::text, row_version
                        FROM billing.model_price_versions
                        WHERE model_id = :modelId AND status = 'active'
                        """, new MapSqlParameterSource("modelId", modelId),
                (rs, row) -> priceRow(rs)).stream().findFirst();
    }

    @Override
    public PriceRow saveActive(SaveCommand command) {
        return jdbcTemplate.queryForObject("""
                        SELECT id, model_id, version_no, pricing_unit, base_credits,
                               max_reserve_credits, price_rule::text, row_version
                        FROM billing.save_active_model_price(
                            :id, :modelId, :pricingUnit, :baseCredits, :maxReserveCredits,
                            CAST(:priceRule AS jsonb), :createdByUserId, :expectedRowVersion
                        )
                        """, new MapSqlParameterSource()
                        .addValue("id", command.id())
                        .addValue("modelId", command.modelId())
                        .addValue("pricingUnit", command.pricingUnit())
                        .addValue("baseCredits", command.baseCredits())
                        .addValue("maxReserveCredits", command.maxReserveCredits())
                        .addValue("priceRule", json(command.priceRule()))
                        .addValue("createdByUserId", command.createdByUserId())
                        .addValue("expectedRowVersion", command.expectedRowVersion()),
                (rs, row) -> priceRow(rs));
    }

    private PriceRow priceRow(ResultSet rs) throws SQLException {
        return new PriceRow(
                rs.getObject("id", UUID.class), rs.getObject("model_id", UUID.class),
                rs.getLong("version_no"), rs.getString("pricing_unit"),
                rs.getLong("base_credits"), rs.getLong("max_reserve_credits"),
                jsonObject(rs.getString("price_rule")), rs.getLong("row_version")
        );
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> jsonObject(String value) {
        try {
            return Collections.unmodifiableMap(new LinkedHashMap<>(objectMapper.readValue(value, Map.class)));
        } catch (Exception exception) {
            throw new IllegalStateException("Stored model price JSON is invalid", exception);
        }
    }

    private String json(Map<String, Object> value) {
        try {
            return objectMapper.writeValueAsString(value == null ? Map.of() : value);
        } catch (Exception exception) {
            throw new IllegalStateException("Model price JSON could not be serialized", exception);
        }
    }
}
