package com.lingzhen.center.service.impl;

import com.lingzhen.center.repository.HealthRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class HealthServiceImplTest {

    @Mock
    private HealthRepository healthRepository;

    @Test
    void shouldReturnRepositoryReadinessResult() {
        when(healthRepository.isDatabaseReady()).thenReturn(true);

        assertThat(new HealthServiceImpl(healthRepository).isReady()).isTrue();
    }

    @Test
    void shouldHideRepositoryFailureAndReportNotReady() {
        when(healthRepository.isDatabaseReady()).thenThrow(new IllegalStateException("database detail"));

        assertThat(new HealthServiceImpl(healthRepository).isReady()).isFalse();
    }
}
