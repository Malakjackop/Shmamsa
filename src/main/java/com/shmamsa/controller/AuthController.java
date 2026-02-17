package com.shmamsa.controller;

import com.shmamsa.dto.ProfileUpdateRequest;
import com.shmamsa.dto.LoginRequest;
import com.shmamsa.dto.ForgotPasswordRequest;
import com.shmamsa.dto.ResetPasswordRequest;
import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.User;
import com.shmamsa.service.AuthService;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {

    private final AuthService authService;


    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request) {
        authService.register(request);
        return ResponseEntity.ok(Map.of("message", "User registered successfully"));
    }

    

@PostMapping("/register-servant")
public ResponseEntity<?> registerServant(@Valid @RequestBody RegisterServantRequest request) {
    authService.registerServant(request);
    return ResponseEntity.ok(Map.of("message", "User registered successfully as KHADIM"));
}

    @PostMapping("/login")
    public ResponseEntity<?> login(@Valid @RequestBody LoginRequest request, HttpServletResponse response) {

        String token = authService.login(request.getUsername(), request.getPassword());

        ResponseCookie cookie = ResponseCookie.from("jwt", token)
                .httpOnly(true)
                .secure(false)
                .path("/")
                .maxAge(24 * 60 * 60)
                .sameSite("Lax")
                .build();

        response.addHeader("Set-Cookie", cookie.toString());
        return ResponseEntity.ok(Map.of("message", "Login successful"));
    }

    @GetMapping("/user")
    public ResponseEntity<?> getFullUser(Authentication authentication) {

        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.ok(Map.of("authenticated", false));
        }

        String username = authentication.getName();
        User user = authService.findByUsername(username);

        if (user == null) {
            return ResponseEntity.ok(Map.of("authenticated", false));
        }

        user.setPassword(null);

        // Hide internal/system family label from responses
        if ("DEVELOPER".equalsIgnoreCase(user.getRole()) && "SYSTEM".equalsIgnoreCase(user.getDeaconFamily())) {
            user.setDeaconFamily(null);
        }

        return ResponseEntity.ok(user);
    }

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

    @PostMapping("/forgot-password")
    public ResponseEntity<?> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        Map<String, Object> result = authService.generateResetTokenByEmail(request.getEmail().trim());
        return ResponseEntity.ok(result);
    }

    @PostMapping("/reset-password")
    public ResponseEntity<?> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {

        authService.resetPassword(request.getToken().trim(), request.getNewPassword().trim());
        return ResponseEntity.ok(Map.of("message", "Password reset successfully"));
    }

    @PutMapping("/profile")
    public ResponseEntity<?> updateProfile(@RequestBody ProfileUpdateRequest updated, Authentication authentication) {

        if (authentication == null || !authentication.isAuthenticated()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "User not authenticated");
        }

        String username = authentication.getName();
        User existingUser = authService.findByUsername(username);

        if (existingUser == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found");
        }

            existingUser.setFullName(updated.getFullName());
            existingUser.setPhoneNumber(updated.getPhoneNumber());
            existingUser.setAddress(updated.getAddress());
            existingUser.setGuardiansPhone(updated.getGuardiansPhone());
            existingUser.setGuardianRelation(updated.getGuardianRelation());
            existingUser.setDeaconDegree(updated.getDeaconDegree());
            existingUser.setStudyType(updated.getStudyType());
            existingUser.setSchoolName(updated.getSchoolName());
            existingUser.setStatus(updated.getStatus());
            existingUser.setSchoolGrade(updated.getSchoolGrade());
            existingUser.setUniversityName(updated.getUniversityName());
            existingUser.setFaculty(updated.getFaculty());
            existingUser.setUniversityGrade(updated.getUniversityGrade());
            existingUser.setGraduatedFrom(updated.getGraduatedFrom());
            existingUser.setGraduateJob(updated.getGraduateJob());
            existingUser.setWorkDetails(updated.getWorkDetails());

            authService.saveUser(existingUser);

            existingUser.setPassword(null);
            return ResponseEntity.ok(existingUser);
    }
}
