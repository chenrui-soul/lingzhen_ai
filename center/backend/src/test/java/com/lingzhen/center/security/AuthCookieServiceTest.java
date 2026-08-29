package com.lingzhen.center.security;

import com.lingzhen.center.config.AuthProperties;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

import java.time.Duration;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class AuthCookieServiceTest {

    private final AuthCookieService service = new AuthCookieService(
            properties(),
            new StubTokenGenerator()
    );

    @Test
    void managementCredentialsKeepRefreshScopedAndExposeCsrfAtApplicationRoot() {
        MockHttpServletResponse response = new MockHttpServletResponse();

        service.writeManagementCredentials(response, "refresh-value", Duration.ofDays(30));

        List<String> cookies = response.getHeaders("Set-Cookie");
        assertThat(cookies).anySatisfy(cookie -> assertThat(cookie)
                .contains("LZ_REFRESH=refresh-value")
                .contains("Path=/api/v1/auth")
                .contains("HttpOnly"));
        assertThat(cookies).anySatisfy(cookie -> assertThat(cookie)
                .contains("LZ_CSRF=csrf-value")
                .contains("Path=/")
                .doesNotContain("HttpOnly"));
        assertThat(cookies).anySatisfy(cookie -> assertThat(cookie)
                .contains("LZ_CSRF=")
                .contains("Path=/api/v1/auth")
                .contains("Max-Age=0"));
    }

    @Test
    void cookieRefreshRequiresMatchingCsrfHeader() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(
                new Cookie("LZ_REFRESH", "refresh-value"),
                new Cookie("LZ_CSRF", "csrf-value")
        );
        request.addHeader("X-CSRF-Token", "csrf-value");

        assertThat(service.resolveRefreshToken(null, request)).isEqualTo("refresh-value");
    }

    @Test
    void csrfValidationAcceptsTheMatchingCookieWhenLegacyAndCurrentPathsCoexist() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(
                new Cookie("LZ_REFRESH", "refresh-value"),
                new Cookie("LZ_CSRF", "legacy-value"),
                new Cookie("LZ_CSRF", "csrf-value")
        );
        request.addHeader("X-CSRF-Token", "csrf-value");

        assertThat(service.resolveRefreshToken(null, request)).isEqualTo("refresh-value");
    }

    private AuthProperties properties() {
        return new AuthProperties(
                "lingzhen-center",
                "test-secret",
                Duration.ofMinutes(10),
                Duration.ofDays(30),
                Duration.ofMinutes(5),
                5,
                Duration.ofMinutes(15),
                false
        );
    }

    private static final class StubTokenGenerator implements SecureTokenGenerator {

        @Override
        public OpaqueToken generate() {
            return new OpaqueToken("csrf-value", new byte[32]);
        }

        @Override
        public byte[] hash(String rawToken) {
            return new byte[32];
        }
    }
}
