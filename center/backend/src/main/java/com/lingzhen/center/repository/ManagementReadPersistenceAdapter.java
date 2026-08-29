package com.lingzhen.center.repository;

import jakarta.persistence.EntityManager;
import org.springframework.stereotype.Repository;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

@Repository
public class ManagementReadPersistenceAdapter implements ManagementReadRepository {

    private final EntityManager entityManager;

    public ManagementReadPersistenceAdapter(EntityManager entityManager) {
        this.entityManager = entityManager;
    }

    @Override
    public Optional<DashboardSnapshot> findDashboard(UUID tenantId, Instant now) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT t.id, t.tenant_code, t.display_name, t.status,
                               (SELECT count(*) FROM identity.tenant_memberships m
                                WHERE m.tenant_id = t.id AND m.status <> 'removed'),
                               (SELECT count(*) FROM identity.tenant_memberships m
                                WHERE m.tenant_id = t.id AND m.status = 'active'),
                               (SELECT count(*) FROM identity.tenant_memberships m
                                WHERE m.tenant_id = t.id AND m.status = 'suspended'),
                               (SELECT count(*) FROM identity.user_sessions s
                                WHERE s.tenant_id = t.id AND s.status = 'active'
                                  AND s.expires_at > :now)
                        FROM identity.tenants t
                        WHERE t.id = :tenantId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("now", now)
                .setMaxResults(1)
                .getResultList();

        if (rows.isEmpty()) {
            return Optional.empty();
        }

        Object[] row = rows.getFirst();
        return Optional.of(new DashboardSnapshot(
                (UUID) row[0],
                (String) row[1],
                (String) row[2],
                (String) row[3],
                number(row[4]),
                number(row[5]),
                number(row[6]),
                number(row[7]),
                findRoleCounts(tenantId)
        ));
    }

    @Override
    public MemberPage findMembers(
            UUID tenantId,
            String keyword,
            String status,
            int offset,
            int limit,
            Instant now
    ) {
        StringBuilder where = new StringBuilder(" WHERE m.tenant_id = :tenantId ");
        if (status == null) {
            where.append(" AND m.status <> 'removed' ");
        } else {
            where.append(" AND m.status = :status ");
        }
        if (keyword != null) {
            where.append("""
                     AND (
                         lower(coalesce(u.username, '')) LIKE :keyword ESCAPE '\\'
                         OR lower(coalesce(u.email, '')) LIKE :keyword ESCAPE '\\'
                     )
                    """);
        }

        String countSql = """
                SELECT count(*)
                FROM identity.tenant_memberships m
                JOIN identity.users u ON u.id = m.user_id
                """ + where;
        var countQuery = entityManager.createNativeQuery(countSql)
                .setParameter("tenantId", tenantId);
        applyFilters(countQuery, keyword, status);
        long total = number(countQuery.getSingleResult());

        String dataSql = """
                SELECT m.id, u.id, u.username, u.email, u.status, m.status,
                       r.code, r.display_name, m.joined_at, u.last_login_at,
                       (SELECT count(*) FROM identity.user_sessions s
                        WHERE s.membership_id = m.id AND s.status = 'active'
                          AND s.expires_at > :now)
                FROM identity.tenant_memberships m
                JOIN identity.users u ON u.id = m.user_id
                JOIN identity.roles r ON r.id = m.role_id
                """ + where + """
                 ORDER BY CASE m.status WHEN 'active' THEN 0 WHEN 'invited' THEN 1
                                        WHEN 'suspended' THEN 2 ELSE 3 END,
                          coalesce(m.joined_at, m.created_at) DESC,
                          m.id
                """;
        var dataQuery = entityManager.createNativeQuery(dataSql)
                .setParameter("tenantId", tenantId)
                .setParameter("now", now)
                .setFirstResult(offset)
                .setMaxResults(limit);
        applyFilters(dataQuery, keyword, status);

        @SuppressWarnings("unchecked")
        List<Object[]> rows = dataQuery.getResultList();
        return new MemberPage(rows.stream().map(this::toMemberRow).toList(), total);
    }

    @Override
    public Optional<TenantSnapshot> findTenant(UUID tenantId, Instant now) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT t.id, t.tenant_code, t.display_name, t.status, t.created_at,
                               (SELECT count(*) FROM identity.tenant_memberships m
                                WHERE m.tenant_id = t.id AND m.status <> 'removed'),
                               (SELECT count(*) FROM identity.tenant_memberships m
                                WHERE m.tenant_id = t.id AND m.status = 'active'),
                               (SELECT count(*) FROM identity.tenant_memberships m
                                WHERE m.tenant_id = t.id AND m.status = 'suspended'),
                               (SELECT count(*) FROM identity.user_sessions s
                                WHERE s.tenant_id = t.id AND s.status = 'active'
                                  AND s.expires_at > :now)
                        FROM identity.tenants t
                        WHERE t.id = :tenantId
                        """)
                .setParameter("tenantId", tenantId)
                .setParameter("now", now)
                .setMaxResults(1)
                .getResultList();
        return rows.stream().findFirst().map(row -> new TenantSnapshot(
                (UUID) row[0],
                (String) row[1],
                (String) row[2],
                (String) row[3],
                instant(row[4]),
                number(row[5]),
                number(row[6]),
                number(row[7]),
                number(row[8])
        ));
    }

    private List<RoleCount> findRoleCounts(UUID tenantId) {
        @SuppressWarnings("unchecked")
        List<Object[]> rows = entityManager.createNativeQuery("""
                        SELECT r.code, r.display_name, count(*)
                        FROM identity.tenant_memberships m
                        JOIN identity.roles r ON r.id = m.role_id
                        WHERE m.tenant_id = :tenantId
                          AND m.status <> 'removed'
                        GROUP BY r.code, r.display_name
                        ORDER BY count(*) DESC, r.code
                        """)
                .setParameter("tenantId", tenantId)
                .getResultList();
        return rows.stream()
                .map(row -> new RoleCount((String) row[0], (String) row[1], number(row[2])))
                .toList();
    }

    private void applyFilters(jakarta.persistence.Query query, String keyword, String status) {
        if (status != null) {
            query.setParameter("status", status);
        }
        if (keyword != null) {
            query.setParameter("keyword", '%' + escapeLike(keyword.toLowerCase(Locale.ROOT)) + '%');
        }
    }

    private MemberRow toMemberRow(Object[] row) {
        return new MemberRow(
                (UUID) row[0],
                (UUID) row[1],
                (String) row[2],
                (String) row[3],
                (String) row[4],
                (String) row[5],
                (String) row[6],
                (String) row[7],
                instant(row[8]),
                instant(row[9]),
                number(row[10])
        );
    }

    private long number(Object value) {
        return ((Number) value).longValue();
    }

    private Instant instant(Object value) {
        if (value == null) {
            return null;
        }
        if (value instanceof Instant instant) {
            return instant;
        }
        if (value instanceof OffsetDateTime offsetDateTime) {
            return offsetDateTime.toInstant();
        }
        if (value instanceof Timestamp timestamp) {
            return timestamp.toInstant();
        }
        throw new IllegalStateException("Unsupported timestamp value: " + value.getClass().getName());
    }

    private String escapeLike(String value) {
        return value.replace("\\", "\\\\")
                .replace("%", "\\%")
                .replace("_", "\\_");
    }
}
