package com.shmamsa.config;

import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.config.annotation.authentication.configuration.AuthenticationConfiguration;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.http.HttpMethod;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.CorsConfigurationSource;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;

import java.util.List;

@Configuration
@RequiredArgsConstructor
public class SecurityConfig {

    private final JwtFilter jwtFilter;

    @Bean
    public BCryptPasswordEncoder passwordEncoder() {
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {

        http
                .csrf(csrf -> csrf.disable())
                .cors(cors -> {}) // uses corsConfigurationSource below
                .authorizeHttpRequests(auth -> auth
                        .requestMatchers(
                                "/api/auth/login",
                                "/api/auth/register",
                                "/api/auth/register-servant",
                                "/api/auth/forgot-password",
                                "/api/auth/reset-password",
                                "/api/auth/user"
                        ).permitAll()
                                .requestMatchers(org.springframework.http.HttpMethod.GET, "/api/attendance/history").authenticated()
                                .requestMatchers(HttpMethod.POST, "/api/attendance/scan-token").permitAll()
.requestMatchers(HttpMethod.GET, "/api/attendance/my-stats").authenticated()

                        .requestMatchers("/api/attendance/**")
                        .hasAnyRole("KHADIM","AMIN_OSRA","AMIN_KHEDMA","DEVELOPER")
.requestMatchers("/api/family/**")
.hasAnyRole("KHADIM","AMIN_OSRA","AMIN_KHEDMA","DEVELOPER")

.requestMatchers("/api/admin/**")
.hasAnyRole("AMIN_KHEDMA","DEVELOPER")

                                .requestMatchers("/api/khors-requests/**")
                                .hasAnyRole("KHADIM","AMIN_KHEDMA","DEVELOPER")

                                .requestMatchers("/api/resources/**").authenticated()
                                .anyRequest().authenticated()
                )
                .addFilterBefore(jwtFilter, UsernamePasswordAuthenticationFilter.class);

        return http.build();
    }

    @Bean
    public AuthenticationManager authenticationManager(AuthenticationConfiguration config) throws Exception {
        return config.getAuthenticationManager();
    }

    @Bean
    public CorsConfigurationSource corsConfigurationSource() {
        CorsConfiguration configuration = new CorsConfiguration();

        configuration.setAllowedOrigins(List.of("http://localhost:4200"));

        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));

        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Requested-With", "X-REG-SECRET"));

        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
