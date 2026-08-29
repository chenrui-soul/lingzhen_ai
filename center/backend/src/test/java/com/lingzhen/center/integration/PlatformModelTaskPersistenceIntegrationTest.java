package com.lingzhen.center.integration;

import com.lingzhen.center.repository.PlatformModelTaskRepository;
import com.lingzhen.center.repository.PlatformModelTaskPersistenceAdapter;
import com.lingzhen.center.repository.PlatformCreditRepository;
import com.lingzhen.center.exception.ApiException;
import com.lingzhen.center.service.PlatformTaskBillingService;
import com.lingzhen.center.service.PlatformTaskTransitionService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import tools.jackson.databind.ObjectMapper;

import javax.sql.DataSource;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
class PlatformModelTaskPersistenceIntegrationTest extends PostgreSqlIdentityTestSupport {

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @Autowired
    private DataSource dataSource;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PlatformModelTaskRepository tasks;

    @Autowired
    private PlatformCreditRepository credits;

    @Autowired
    private PlatformTaskBillingService billing;

    @Autowired
    private PlatformTaskTransitionService transitions;

    private Fixture fixture;
    private List<String> recoverableStates;
    private JdbcTemplate ownerJdbcTemplate;

    @BeforeEach
    void setUp() throws Exception {
        recoverableStates = objectMapper.readTree(Files.readString(
                        Path.of("references", "platform_model_task_persistence_ground_truth.json")))
                .path("recoverableStates")
                .valueStream()
                .map(node -> node.asText())
                .toList();
        ownerJdbcTemplate = new JdbcTemplate(new DriverManagerDataSource(
                POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
        ));
        fixture = fixture();
    }

    @Test
    void persistsTaskAndFreshRepositoryCanReadItAfterServiceRestart() {
        UUID taskId = UUID.randomUUID();
        PlatformModelTaskRepository.TaskRow created = tasks.create(new PlatformModelTaskRepository.CreateCommand(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "gateway",
                "video", "restart-" + compactId(), "submitting"
        )).orElseThrow();

        assertThat(created.id()).isEqualTo(taskId);
        assertThat(created.rowVersion()).isZero();

        PlatformModelTaskRepository freshRepository = new PlatformModelTaskPersistenceAdapter(
                new NamedParameterJdbcTemplate(dataSource), objectMapper
        );
        PlatformModelTaskRepository.TaskRow loaded = freshRepository
                .findOwned(fixture.tenantId(), fixture.userId(), taskId)
                .orElseThrow();

        assertThat(loaded.id()).isEqualTo(taskId);
        assertThat(loaded.state()).isEqualTo("submitting");
        assertThat(recoverableStates).contains(loaded.state());
        assertThat(loaded.clientRequestId()).isEqualTo(created.clientRequestId());
    }

    @Test
    void clientRequestIdIsIdempotentOnlyWithinTheSameUserAndTenant() {
        String clientRequestId = "same-request-" + compactId();
        PlatformModelTaskRepository.CreateCommand command = new PlatformModelTaskRepository.CreateCommand(
                UUID.randomUUID(), fixture.tenantId(), fixture.userId(), fixture.modelId(), "gateway",
                "video", clientRequestId, "submitting"
        );

        assertThat(tasks.create(command)).isPresent();
        assertThat(tasks.create(new PlatformModelTaskRepository.CreateCommand(
                UUID.randomUUID(), fixture.tenantId(), fixture.userId(), fixture.modelId(), "gateway",
                "video", clientRequestId, "submitting"
        ))).isEmpty();

        Fixture otherUser = fixture();
        assertThat(tasks.create(new PlatformModelTaskRepository.CreateCommand(
                UUID.randomUUID(), otherUser.tenantId(), otherUser.userId(), otherUser.modelId(), "gateway",
                "video", clientRequestId, "submitting"
        ))).isPresent();
    }

    @Test
    void ownershipFilterPreventsCrossTenantOrCrossUserReads() {
        UUID taskId = UUID.randomUUID();
        tasks.create(new PlatformModelTaskRepository.CreateCommand(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "gateway",
                "video", "owned-" + compactId(), "pending"
        )).orElseThrow();

        Fixture other = fixture();
        assertThat(tasks.findOwned(other.tenantId(), fixture.userId(), taskId)).isEmpty();
        assertThat(tasks.findOwned(fixture.tenantId(), other.userId(), taskId)).isEmpty();
        assertThat(tasks.findOwned(fixture.tenantId(), fixture.userId(), taskId)).isPresent();
    }

    @Test
    void staleRowVersionCannotOverwriteANewerTaskState() {
        UUID taskId = UUID.randomUUID();
        PlatformModelTaskRepository.TaskRow created = tasks.create(new PlatformModelTaskRepository.CreateCommand(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "gateway",
                "video", "version-" + compactId(), "pending"
        )).orElseThrow();

        PlatformModelTaskRepository.UpdateCommand complete = new PlatformModelTaskRepository.UpdateCommand(
                taskId, fixture.tenantId(), fixture.userId(), "completed", "job-1", List.of("https://cdn.example/result.mp4"),
                "", "", "", created.rowVersion()
        );
        PlatformModelTaskRepository.TaskRow updated = tasks.update(complete).orElseThrow();
        assertThat(updated.rowVersion()).isEqualTo(1);

        assertThat(tasks.update(new PlatformModelTaskRepository.UpdateCommand(
                taskId, fixture.tenantId(), fixture.userId(), "failed", "job-1", List.of(),
                "", "STALE", "stale update", created.rowVersion()
        ))).isEmpty();

        assertThat(tasks.findOwned(fixture.tenantId(), fixture.userId(), taskId).orElseThrow().state())
                .isEqualTo("completed");
    }

    @Test
    void reservationSettlementAndReleaseAreAtomicAndIdempotent() {
        ownerJdbcTemplate.update(
                "UPDATE billing.user_wallets SET available_balance = 100, reserved_balance = 0 WHERE user_id = ?",
                fixture.userId());
        UUID reservationId = UUID.randomUUID();
        PlatformCreditRepository.ReserveCommand reserve = new PlatformCreditRepository.ReserveCommand(
                reservationId, fixture.userId(), fixture.tenantId(), "task-credit-" + compactId(), "attempt-1",
                "request-credit-" + compactId(), fixture.priceVersionId(), 10, "reserve-key-" + compactId(),
                java.time.Instant.now().plusSeconds(900), UUID.randomUUID());

        PlatformCreditRepository.CreditMutationResult reserved = credits.reserve(reserve);
        assertThat(reserved.status()).isEqualTo("reserved");
        assertThat(reserved.availableBalance()).isEqualTo(90);
        assertThat(reserved.reservedBalance()).isEqualTo(10);
        assertThat(credits.reserve(reserve).idempotentReplay()).isTrue();

        PlatformCreditRepository.CreditMutationResult settled = credits.settle(new PlatformCreditRepository.SettleCommand(
                reservationId, reserve.taskId(), reserve.attemptId(), 6, "https://cdn.example/result.mp4",
                "settle-key-" + compactId(), UUID.randomUUID(), UUID.randomUUID()));
        assertThat(settled.status()).isEqualTo("settled");
        assertThat(settled.availableBalance()).isEqualTo(94);
        assertThat(settled.reservedBalance()).isZero();
        assertThat(credits.settle(new PlatformCreditRepository.SettleCommand(
                reservationId, reserve.taskId(), reserve.attemptId(), 6, "https://cdn.example/result.mp4",
                "settle-replay-" + compactId(), UUID.randomUUID(), UUID.randomUUID())).idempotentReplay()).isTrue();

        UUID releaseReservationId = UUID.randomUUID();
        PlatformCreditRepository.ReserveCommand releaseReserve = new PlatformCreditRepository.ReserveCommand(
                releaseReservationId, fixture.userId(), fixture.tenantId(), "task-release-" + compactId(), "attempt-1",
                "request-release-" + compactId(), fixture.priceVersionId(), 7, "release-reserve-" + compactId(),
                java.time.Instant.now().plusSeconds(900), UUID.randomUUID());
        credits.reserve(releaseReserve);
        PlatformCreditRepository.CreditMutationResult released = credits.release(new PlatformCreditRepository.ReleaseCommand(
                releaseReservationId, releaseReserve.taskId(), releaseReserve.attemptId(),
                "release-key-" + compactId(), UUID.randomUUID()));
        assertThat(released.status()).isEqualTo("released");
        assertThat(released.availableBalance()).isEqualTo(94);
        assertThat(released.reservedBalance()).isZero();
    }

    @Test
    void taskBillingUsesActivePriceReserveAndStoredPriceVersionSettlement() {
        ownerJdbcTemplate.update(
                "UPDATE billing.user_wallets SET available_balance = 20, reserved_balance = 0 WHERE user_id = ?",
                fixture.userId());
        UUID taskId = UUID.randomUUID();

        billing.reserve(new PlatformTaskBillingService.ReservationRequest(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "billing-" + compactId()));

        assertThat(walletBalances()).containsExactly(10L, 10L);
        PlatformCreditRepository.ReservationRow reserved = credits.findByTaskId(taskId.toString()).orElseThrow();
        assertThat(reserved.status()).isEqualTo("reserved");
        assertThat(reserved.priceVersionId()).isEqualTo(fixture.priceVersionId());
        assertThat(reserved.reservedCredits()).isEqualTo(10);

        billing.settle(taskId, "https://cdn.example/result.mp4");
        billing.settle(taskId, "https://cdn.example/result.mp4");

        assertThat(walletBalances()).containsExactly(15L, 0L);
        PlatformCreditRepository.ReservationRow settled = credits.findByTaskId(taskId.toString()).orElseThrow();
        assertThat(settled.status()).isEqualTo("settled");
        assertThat(settled.settledCredits()).isEqualTo(5);
    }

    @Test
    void insufficientCreditsDoNotCreateAReservation() {
        ownerJdbcTemplate.update(
                "UPDATE billing.user_wallets SET available_balance = 3, reserved_balance = 0 WHERE user_id = ?",
                fixture.userId());
        UUID taskId = UUID.randomUUID();

        assertThatThrownBy(() -> billing.reserve(new PlatformTaskBillingService.ReservationRequest(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "insufficient-" + compactId())))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.code()).isEqualTo("CREDIT_INSUFFICIENT"));

        assertThat(credits.findByTaskId(taskId.toString())).isEmpty();
        assertThat(walletBalances()).containsExactly(3L, 0L);
    }

    @Test
    void taskBillingReleaseIsIdempotent() {
        ownerJdbcTemplate.update(
                "UPDATE billing.user_wallets SET available_balance = 20, reserved_balance = 0 WHERE user_id = ?",
                fixture.userId());
        UUID taskId = UUID.randomUUID();
        billing.reserve(new PlatformTaskBillingService.ReservationRequest(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "release-" + compactId()));

        billing.release(taskId);
        billing.release(taskId);

        assertThat(walletBalances()).containsExactly(20L, 0L);
        assertThat(credits.findByTaskId(taskId.toString()).orElseThrow().status()).isEqualTo("released");
    }

    @Test
    void terminalTaskTransitionAndSettlementCommitTogether() {
        ownerJdbcTemplate.update(
                "UPDATE billing.user_wallets SET available_balance = 20, reserved_balance = 0 WHERE user_id = ?",
                fixture.userId());
        UUID taskId = UUID.randomUUID();
        PlatformModelTaskRepository.TaskRow pending = tasks.create(new PlatformModelTaskRepository.CreateCommand(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), "gateway",
                "video", "transition-" + compactId(), "pending"
        )).orElseThrow();
        billing.reserve(new PlatformTaskBillingService.ReservationRequest(
                taskId, fixture.tenantId(), fixture.userId(), fixture.modelId(), pending.clientRequestId()));

        boolean updated = transitions.transition(
                new PlatformTaskTransitionService.TransitionCommand(
                        taskId, fixture.tenantId(), fixture.userId(), "completed", "job-transition",
                        List.of("https://cdn.example/transition.mp4"), "", "", "", pending.rowVersion()),
                PlatformTaskTransitionService.BillingAction.SETTLE,
                "https://cdn.example/transition.mp4"
        );
        PlatformModelTaskRepository.TaskRow completed = tasks.findOwned(
                fixture.tenantId(), fixture.userId(), taskId).orElseThrow();

        assertThat(updated).isTrue();
        assertThat(completed.state()).isEqualTo("completed");
        assertThat(credits.findByTaskId(taskId.toString()).orElseThrow().status()).isEqualTo("settled");
        assertThat(walletBalances()).containsExactly(15L, 0L);
    }

    private List<Long> walletBalances() {
        return jdbcTemplate.queryForObject(
                "SELECT ARRAY[available_balance, reserved_balance] FROM billing.user_wallets WHERE user_id = ?",
                (resultSet, row) -> java.util.Arrays.asList((Long[]) resultSet.getArray(1).getArray()),
                fixture.userId()
        );
    }

    private Fixture fixture() {
        UUID tenantId = UUID.randomUUID();
        UUID userId = UUID.randomUUID();
        UUID providerId = UUID.randomUUID();
        UUID modelId = UUID.randomUUID();
        String suffix = compactId();
        UUID memberRoleId = jdbcTemplate.queryForObject(
                "SELECT id FROM identity.roles WHERE code = 'member'", UUID.class
        );
        jdbcTemplate.update(
                "INSERT INTO identity.tenants (id, tenant_code, display_name) VALUES (?, ?, ?)",
                tenantId, "task_" + suffix, "Platform task tenant"
        );
        jdbcTemplate.update(
                "INSERT INTO identity.users (id, username, email, password_hash) VALUES (?, ?, ?, ?)",
                userId, "task_user_" + suffix, "task." + suffix + "@example.com", "test-hash"
        );
        jdbcTemplate.update("""
                INSERT INTO identity.tenant_memberships
                    (id, tenant_id, user_id, role_id, status, joined_at)
                VALUES (?, ?, ?, ?, 'active', now())
                """, UUID.randomUUID(), tenantId, userId, memberRoleId);
        jdbcTemplate.update("""
                INSERT INTO model_catalog.providers
                    (id, provider_code, display_name, protocol_family, status)
                VALUES (?, ?, ?, 'custom_proxy', 'active')
                """, providerId, "task_provider_" + suffix, "Task provider");
        jdbcTemplate.update("""
                INSERT INTO model_catalog.models
                    (id, provider_id, model_code, display_name, capability_type, status)
                VALUES (?, ?, ?, ?, 'video', 'active')
                """, modelId, providerId, "task-model-" + suffix, "Task model");
        UUID priceVersionId = UUID.randomUUID();
        ownerJdbcTemplateOrCreate().update("""
                INSERT INTO billing.model_price_versions
                    (id, model_id, version_no, pricing_unit, base_credits, max_reserve_credits,
                     price_rule, content_hash, status, activated_at)
                VALUES (?, ?, 1, 'request', 5, 10, '{}'::jsonb,
                        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
                        'active', now())
                """, priceVersionId, modelId);
        return new Fixture(tenantId, userId, modelId, priceVersionId);
    }

    private JdbcTemplate ownerJdbcTemplateOrCreate() {
        if (ownerJdbcTemplate == null) {
            ownerJdbcTemplate = new JdbcTemplate(new DriverManagerDataSource(
                    POSTGRES.getJdbcUrl(), POSTGRES.getUsername(), POSTGRES.getPassword()
            ));
        }
        return ownerJdbcTemplate;
    }

    private String compactId() {
        return UUID.randomUUID().toString().replace("-", "").substring(0, 12);
    }

    private record Fixture(UUID tenantId, UUID userId, UUID modelId, UUID priceVersionId) {
    }
}
