package com.shmamsa.controller;

import com.shmamsa.dto.ProfileUpdateRequest;
import com.shmamsa.dto.LoginRequest;
import com.shmamsa.dto.FamilyOptionDto;
import com.shmamsa.dto.ForgotPasswordRequest;
import com.shmamsa.dto.ResetPasswordRequest;
import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.User;
import com.shmamsa.service.AttendanceBackfillService;
import com.shmamsa.service.AuthService;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.FamilyCatalogService;
import com.shmamsa.service.UserFamilyRoleService;
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
    private final AttendanceBackfillService attendanceBackfillService;
    private final FamilyCatalogService familyCatalogService;
    private final FamilyAccessService familyAccessService;
    private final UserFamilyRoleService userFamilyRoleService;


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

    @GetMapping("/family-options")
    public ResponseEntity<java.util.List<FamilyOptionDto>> familyOptions(
            @RequestParam(defaultValue = "MEMBER") String audience
    ) {
        return ResponseEntity.ok(familyCatalogService.listForAudience(audience));
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

        attendanceBackfillService.backfillForUser(user);
        user.setPassword(null);
        userFamilyRoleService.syncUser(user);

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

        // ✅ Allow updating email from profile (must be unique)
        if (updated.getEmail() != null) {
            String newEmail = updated.getEmail().trim();
            if (!newEmail.isBlank() && !newEmail.equalsIgnoreCase(existingUser.getEmail())) {
                if (authService.isEmailTakenByOther(newEmail, existingUser.getId())) {
                    throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "Email already in use");
                }
                existingUser.setEmail(newEmail);
            }
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
            userFamilyRoleService.syncUser(existingUser);
            return ResponseEntity.ok(existingUser);
    }
}
