package com.shmamsa.config;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;

@Component
@RequiredArgsConstructor
public class JwtFilter extends OncePerRequestFilter {

    private final JwtUtils jwtUtils;
    private final UserRepository userRepository;

    @Override
    protected void doFilterInternal(HttpServletRequest request,
                                    HttpServletResponse response,
                                    FilterChain filterChain)
            throws ServletException, IOException {

        String path = request.getRequestURI();

        if (
                path.startsWith("/api/auth/login") ||
                        path.startsWith("/api/auth/register") ||
                        path.startsWith("/api/auth/register-servant") ||
                        path.startsWith("/api/auth/forgot-password") ||
                        path.startsWith("/api/auth/reset-password")
        ) {
            filterChain.doFilter(request, response);
            return;
        }


        String token = null;

        String authHeader = request.getHeader("Authorization");
        if (authHeader != null && authHeader.startsWith("Bearer ")) {
            token = authHeader.substring(7);
        }

        if (token == null && request.getCookies() != null) {
            for (Cookie cookie : request.getCookies()) {
                if ("jwt".equals(cookie.getName())) {
                    token = cookie.getValue();
                    break;
                }
            }
        }

        if (token != null && jwtUtils.validateToken(token)) {
            String username = jwtUtils.extractUsername(token);
            if (username != null && !username.isBlank()) {
                User user = userRepository.findByUsername(username).orElse(null);
                if (user != null) {
                    String role = user.getRole() == null ? "MAKHDOM" : user.getRole().trim();
                    UsernamePasswordAuthenticationToken authentication =
                            new UsernamePasswordAuthenticationToken(
                                    user.getUsername(),
                                    null,
                                    List.of(new SimpleGrantedAuthority("ROLE_" + role.replace("ROLE_", "")))
                            );

                    SecurityContextHolder.getContext().setAuthentication(authentication);
                }
            }
        }

        filterChain.doFilter(request, response);
    }
}
