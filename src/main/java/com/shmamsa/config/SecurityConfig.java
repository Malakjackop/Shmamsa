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
                        // ✅ PUBLIC AUTH ENDPOINTS
                        .requestMatchers(
                                "/api/auth/login",
                                "/api/auth/register",
                                "/api/auth/register-servant",
                                "/api/auth/forgot-password",
                                "/api/auth/reset-password",
                                // ✅ allow session check endpoint (returns user only if authenticated)
                                "/api/auth/user"
                        ).permitAll()

                        // ✅ Attendance stats: any logged-in user can view *their own* stats
                        

                        // ✅ PUBLIC QR scan (no login required)
                        .requestMatchers(HttpMethod.POST, "/api/attendance/scan-token").permitAll()
.requestMatchers(HttpMethod.GET, "/api/attendance/my-stats").authenticated()

                        // ✅ Attendance submit/management: KHADIM and above
                        .requestMatchers("/api/attendance/**")
                        .hasAnyRole("KHADIM","AMIN_OSRA","AMIN_KHEDMA","DEVELOPER")
// ✅ Family pages: KHADIM and above
.requestMatchers("/api/family/**")
.hasAnyRole("KHADIM","AMIN_OSRA","AMIN_KHEDMA","DEVELOPER")

// ✅ Role management: AMIN_KHEDMA and DEVELOPER
.requestMatchers("/api/admin/**")
.hasAnyRole("AMIN_KHEDMA","DEVELOPER")

// 🔐 EVERYTHING ELSE NEEDS LOGIN
                        .anyRequest().authenticated()
                )
                // ✅ IMPORTANT: add jwtFilter so /api/auth/user works
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

        // ✅ allow Angular dev server
        configuration.setAllowedOrigins(List.of("http://localhost:4200"));

        configuration.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));

        configuration.setAllowedHeaders(List.of("Authorization", "Content-Type", "X-Requested-With", "X-REG-SECRET"));

        // ✅ allow sending cookies
        configuration.setAllowCredentials(true);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/**", configuration);
        return source;
    }
}
