package com.shmamsa.controller;

import com.shmamsa.dto.ProfileUpdateRequest;
import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.model.User;
import com.shmamsa.service.AuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import jakarta.validation.ValidationException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;

    // ✅ Register endpoint
    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request) {
        try {
            authService.register(request);
            return ResponseEntity.ok(Map.of("message", "User registered successfully"));
        } catch (ValidationException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    

// ✅ Register-servant endpoint (special link)
@PostMapping("/register-servant")
public ResponseEntity<?> registerServant(@Valid @RequestBody RegisterServantRequest request) {
    try {
        authService.registerServant(request);
        return ResponseEntity.ok(Map.of("message", "User registered successfully as KHADIM"));
    } catch (ValidationException e) {

        return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
    } catch (RuntimeException e) {
        return ResponseEntity.status(403).body(Map.of("error", e.getMessage()));
    }
}

// ✅ Login endpoint — sets JWT as HttpOnly cookie
    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody Map<String, String> request, HttpServletResponse response) {
        String username = request.get("username");
        String password = request.get("password");

        try {
            String token = authService.login(username, password);

            ResponseCookie cookie = ResponseCookie.from("jwt", token)
                    .httpOnly(true)
                    .secure(false) // ✅ true in production with HTTPS
                    .path("/")
                    .maxAge(24 * 60 * 60)
                    .sameSite("Lax")
                    .build();

            response.addHeader("Set-Cookie", cookie.toString());
            return ResponseEntity.ok(Map.of("message", "Login successful"));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ✅ Get logged in user data (requires JWT)
    @GetMapping("/user")
    public ResponseEntity<?> getFullUser(Authentication authentication) {

        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(401).body(Map.of("error", "User not authenticated"));
        }

        String username = authentication.getName();
        User user = authService.findByUsername(username);

        if (user == null) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        user.setPassword(null);
        return ResponseEntity.ok(user);
    }

    // ✅ Logout
    @PostMapping("/logout")
    public ResponseEntity<?> logout(HttpServletResponse response) {

        ResponseCookie cookie = ResponseCookie.from("jwt", "")
                .httpOnly(true)
                .secure(false) // ✅ true in production with HTTPS
                .path("/")
                .maxAge(0)
                .sameSite("Lax")
                .build();

        response.addHeader("Set-Cookie", cookie.toString());
        return ResponseEntity.ok(Map.of("message", "Logged out successfully"));
    }

    // ✅ Forgot Password (EMAIL) -> sends OTP by email
    @PostMapping("/forgot-password")
    public ResponseEntity<?> forgotPassword(@RequestBody Map<String, String> request) {

        String email = request.get("email");

        if (email == null || email.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Email is required"));
        }

        try {
            Map<String, Object> result = authService.generateResetTokenByEmail(email.trim());
            return ResponseEntity.ok(result);
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ✅ Reset Password (OTP + New Password)
    @PostMapping("/reset-password")
    public ResponseEntity<?> resetPassword(@RequestBody Map<String, String> request) {

        String token = request.get("token");
        String newPassword = request.get("newPassword");

        if (token == null || token.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "OTP code is required"));
        }

        if (newPassword == null || newPassword.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Map.of("error", "New password is required"));
        }

        try {
            authService.resetPassword(token.trim(), newPassword.trim());
            return ResponseEntity.ok(Map.of("message", "Password reset successfully"));
        } catch (RuntimeException e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }

    // ✅ Update Profile (requires JWT)
    @PutMapping("/profile")
    public ResponseEntity<?> updateProfile(@RequestBody ProfileUpdateRequest updated, Authentication authentication) {

        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(401).body(Map.of("error", "User not authenticated"));
        }

        try {
            String username = authentication.getName();
            User existingUser = authService.findByUsername(username);

            if (existingUser == null) {
                return ResponseEntity.status(404).body(Map.of("error", "User not found"));
            }

            existingUser.setFullName(updated.getFullName());
            existingUser.setPhoneNumber(updated.getPhoneNumber());
            existingUser.setGuardiansPhone(updated.getGuardiansPhone());
            existingUser.setGuardianRelation(updated.getGuardianRelation());
            existingUser.setDeaconFamily(updated.getDeaconFamily());
            existingUser.setDeaconDegree(updated.getDeaconDegree());
            existingUser.setStatus(updated.getStatus());
            existingUser.setStudyType(updated.getStudyType());
            existingUser.setSchoolName(updated.getSchoolName());
            existingUser.setUniversityName(updated.getUniversityName());
            existingUser.setFaculty(updated.getFaculty());
            existingUser.setUniversityGrade(updated.getUniversityGrade());
            existingUser.setWorkDetails(updated.getWorkDetails());

            authService.saveUser(existingUser);

            return ResponseEntity.ok(Map.of("message", "Profile updated successfully"));
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", e.getMessage()));
        }
    }
}
