package com.shmamsa.controller;

import com.shmamsa.dto.ProfileUpdateRequest;
import com.shmamsa.dto.LoginRequest;
import com.shmamsa.dto.FamilyOptionDto;
import com.shmamsa.dto.ForgotPasswordRequest;
import com.shmamsa.dto.ResetPasswordRequest;
import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.CustomFieldValue;
import com.shmamsa.model.CustomRegistrationField;
import com.shmamsa.model.User;
import com.shmamsa.repository.CustomFieldValueRepository;
import com.shmamsa.repository.CustomRegistrationFieldRepository;
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

import java.util.LinkedHashMap;
import java.util.List;
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
    private final CustomRegistrationFieldRepository customFieldRepo;
    private final CustomFieldValueRepository customFieldValueRepo;

    private Map<String, Object> toCurrentUserView(User user) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", user.getId());
        out.put("authenticated", true);
        out.put("fullName", user.getFullName());
        out.put("username", user.getUsername());
        out.put("email", user.getEmail());
        out.put("phoneNumber", user.getPhoneNumber());
        out.put("address", user.getAddress());
        out.put("guardiansPhone", user.getGuardiansPhone());
        out.put("guardianRelation", user.getGuardianRelation());
        out.put("dateOfBirth", user.getDateOfBirth());
        out.put("gender", user.getGender());
        out.put("status", user.getStatus());
        out.put("studyType", user.getStudyType());
        out.put("schoolName", user.getSchoolName());
        out.put("schoolGrade", user.getSchoolGrade());
        out.put("universityName", user.getUniversityName());
        out.put("faculty", user.getFaculty());
        out.put("universityGrade", user.getUniversityGrade());
        out.put("graduatedFrom", user.getGraduatedFrom());
        out.put("graduateJob", user.getGraduateJob());
        out.put("isWorking", user.getIsWorking());
        out.put("workDetails", user.getWorkDetails());
        out.put("role", user.getRole());
        out.put("deaconDegree", user.getDeaconDegree());
        out.put("khors", user.getKhors());
        out.put("khorsYear", user.getKhorsYear());
        out.put("servingScope", user.getServingScope());
        out.put("attendKhors", user.getAttendKhors());
        out.put("deaconFamily", familyAccessService.primaryFamilyName(user));
        out.put("deaconFamily2", familyAccessService.secondaryFamilyName(user));
        out.put("deaconFamily3", familyAccessService.thirdFamilyName(user));
        out.put("deaconFamily4", familyAccessService.fourthFamilyName(user));
        out.put("deaconFamilyRole", familyAccessService.primaryFamilyRole(user));
        out.put("deaconFamilyRole2", familyAccessService.secondaryFamilyRole(user));
        out.put("deaconFamilyRole3", familyAccessService.thirdFamilyRole(user));
        out.put("deaconFamilyRole4", familyAccessService.fourthFamilyRole(user));
        out.put("familyAssignments", user.getFamilyAssignments());

        // Attach custom field values
        List<CustomFieldValue> cfValues = customFieldValueRepo.findAllByUserId(user.getId());
        Map<String, String> customFields = new LinkedHashMap<>();
        for (CustomFieldValue cv : cfValues) {
            customFields.put(cv.getFieldKey(), cv.getValue());
        }
        out.put("customFields", customFields);

        return out;
    }


    @GetMapping("/custom-fields")
    public ResponseEntity<List<CustomRegistrationField>> publicCustomFields() {
        return ResponseEntity.ok(customFieldRepo.findAllByEnabledTrueOrderByDisplayOrderAsc());
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request) {
        User saved = authService.register(request);
        saveCustomFieldValues(saved, request.getCustomFields());
        return ResponseEntity.ok(Map.of("message", "User registered successfully"));
    }

    

@PostMapping("/register-servant")
public ResponseEntity<?> registerServant(@Valid @RequestBody RegisterServantRequest request) {
    User saved = authService.registerServant(request);
    saveCustomFieldValues(saved, request.getCustomFields());
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
        userFamilyRoleService.syncUser(user);

        return ResponseEntity.ok(toCurrentUserView(user));
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
    public ResponseEntity<?> updateProfile(@Valid @RequestBody ProfileUpdateRequest updated, Authentication authentication) {

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
            existingUser.setSchoolName(updated.getSchoolName());
            existingUser.setSchoolGrade(updated.getSchoolGrade());
            existingUser.setUniversityName(updated.getUniversityName());
            existingUser.setFaculty(updated.getFaculty());
            existingUser.setUniversityGrade(updated.getUniversityGrade());
            existingUser.setGraduatedFrom(updated.getGraduatedFrom());
            existingUser.setGraduateJob(updated.getGraduateJob());
            existingUser.setWorkDetails(updated.getWorkDetails());

            authService.saveUser(existingUser);

            userFamilyRoleService.syncUser(existingUser);
            return ResponseEntity.ok(toCurrentUserView(existingUser));
    }

    // ── Save custom field values for a newly registered user ──────────
    private void saveCustomFieldValues(User user, Map<String, String> customFields) {
        if (customFields == null || customFields.isEmpty() || user == null || user.getId() == null) return;

        List<CustomRegistrationField> enabledFields = customFieldRepo.findAllByEnabledTrueOrderByDisplayOrderAsc();
        var allowedKeys = new java.util.HashSet<String>();
        for (CustomRegistrationField f : enabledFields) {
            allowedKeys.add(f.getFieldKey());
        }

        for (var entry : customFields.entrySet()) {
            String key = entry.getKey();
            String val = entry.getValue();
            if (key == null || key.isBlank() || !allowedKeys.contains(key)) continue;
            if (val == null) val = "";

            CustomFieldValue cfv = CustomFieldValue.builder()
                    .userId(user.getId())
                    .fieldKey(key)
                    .value(val.trim())
                    .build();
            customFieldValueRepo.save(cfv);
        }
    }
}
