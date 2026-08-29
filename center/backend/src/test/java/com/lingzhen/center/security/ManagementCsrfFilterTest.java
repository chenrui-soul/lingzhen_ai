package com.lingzhen.center.security;

import com.lingzhen.center.exception.ApiException;
import jakarta.servlet.ServletException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.security.authentication.TestingAuthenticationToken;
import org.springframework.security.core.context.SecurityContextHolder;
import tools.jackson.databind.ObjectMapper;

import java.io.IOException;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doNothing;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

class ManagementCsrfFilterTest {

    private final AuthCookieService cookieService = mock(AuthCookieService.class);
    private final ManagementCsrfFilter filter = new ManagementCsrfFilter(
            cookieService,
            new ObjectMapper()
    );

    @AfterEach
    void clearSecurityContext() {
        SecurityContextHolder.clearContext();
    }

    @Test
    void rejectsManagementWriteWhenCsrfValidationFails() throws Exception {
        authenticate("CLIENT_management_web");
        doThrow(new ApiException(
                HttpStatus.FORBIDDEN,
                "CSRF_VALIDATION_FAILED",
                "管理中心写请求缺少有效的 CSRF 凭据"
        )).when(cookieService).requireManagementCsrf(any());
        MockHttpServletRequest request = request("POST");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request, response, chain);

        assertThat(response.getStatus()).isEqualTo(403);
        assertThat(response.getContentAsString()).contains("CSRF_VALIDATION_FAILED");
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void allowsManagementWriteAfterCsrfValidation() throws Exception {
        authenticate("CLIENT_management_web");
        doNothing().when(cookieService).requireManagementCsrf(any());
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request("PUT"), new MockHttpServletResponse(), chain);

        assertThat(chain.getRequest()).isNotNull();
        verify(cookieService).requireManagementCsrf(any());
    }

    @Test
    void skipsSafeMethodsAndNonManagementClients() throws ServletException, IOException {
        authenticate("CLIENT_management_web");
        MockFilterChain getChain = new MockFilterChain();
        filter.doFilter(request("GET"), new MockHttpServletResponse(), getChain);
        assertThat(getChain.getRequest()).isNotNull();

        authenticate("CLIENT_desktop");
        MockFilterChain desktopChain = new MockFilterChain();
        filter.doFilter(request("POST"), new MockHttpServletResponse(), desktopChain);
        assertThat(desktopChain.getRequest()).isNotNull();

        verify(cookieService, never()).requireManagementCsrf(any());
    }

    private MockHttpServletRequest request(String method) {
        MockHttpServletRequest request = new MockHttpServletRequest(
                method,
                "/api/v1/management/model-catalog/providers"
        );
        request.setServletPath("/api/v1/management/model-catalog/providers");
        return request;
    }

    private void authenticate(String authority) {
        SecurityContextHolder.getContext().setAuthentication(
                new TestingAuthenticationToken("tester", "credential", authority)
        );
    }
}
