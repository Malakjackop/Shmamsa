package com.shmamsa.controller;

import com.shmamsa.model.User;
import com.shmamsa.service.AuthService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import jakarta.servlet.http.HttpServletResponse;
import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    // ✅ Register endpoint
    @PostMapping("/register")
    public ResponseEntity<?> register(@RequestBody User user) {
        try {
            authService.register(user);
            return ResponseEntity.ok(Map.of("message", "User registered successfully"));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ✅ Login endpoint — sets JWT as HttpOnly cookie
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> request, HttpServletResponse response) {
        String username = request.get("username");
        String password = request.get("password");

        try {
            String token = authService.login(username, password);

            // ✅ Create secure HttpOnly cookie for JWT
            ResponseCookie cookie = ResponseCookie.from("jwt", token)
                    .httpOnly(true)
                    .secure(false) // change to true if you're using HTTPS
                    .path("/")
                    .maxAge(24 * 60 * 60) // 1 day
                    .sameSite("Lax")
                    .build();

            // ✅ Add cookie to response
            response.addHeader("Set-Cookie", cookie.toString());

            return ResponseEntity.ok(Map.of("message", "Login successful"));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ✅ Protected profile endpoint — reads user from SecurityContext
    @GetMapping("/user")
    public ResponseEntity<?> getFullUser(Authentication authentication) {
        String username = authentication.getName();
        User user = authService.findByUsername(username);

        if (user == null) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        // ✅ Don’t send password for security reasons
        user.setPassword(null);

        return ResponseEntity.ok(user);
    }


    // ✅ Optional: Logout (clears cookie)
    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletResponse response) {
        ResponseCookie cookie = ResponseCookie.from("jwt", "")
                .httpOnly(true)
                .secure(false)
                .path("/")
                .maxAge(0)
                .sameSite("Lax")
                .build();
        response.addHeader("Set-Cookie", cookie.toString());
        return ResponseEntity.ok(Map.of("message", "Logged out successfully"));
    }
}
