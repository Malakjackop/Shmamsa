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
import com.shmamsa.model.VisibilityConditionConfig;
import com.shmamsa.model.User;
import com.shmamsa.repository.CustomFieldValueRepository;
import com.shmamsa.repository.CustomRegistrationFieldRepository;
import com.shmamsa.service.AttendanceBackfillService;
import com.shmamsa.service.AttendanceAccessGrantService;
import com.shmamsa.service.AttendanceConfigService;
import com.shmamsa.service.AuthService;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.FamilyCatalogService;
import com.shmamsa.service.UserFamilyRoleService;
import com.shmamsa.util.NationalIdUtils;
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
import java.util.Locale;

@RestController
@RequestMapping("/api/auth")
@RequiredArgsConstructor
public class AuthController {
    private static final java.util.Set<String> KNOWN_SCHOOL_GRADES = java.util.Set.of(
            "أولى ابتدائي", "تانية ابتدائي", "تالتة ابتدائي", "رابعة ابتدائي", "خامسة ابتدائي", "سادسة ابتدائي",
            "أولى إعدادي", "تانية إعدادي", "تالتة إعدادي",
            "أولى ثانوي", "تانية ثانوي", "تالتة ثانوي",
            "other"
    );
    private static final java.util.Map<String, java.util.Set<String>> SYSTEM_FIELD_DEFAULT_SHOW_IN = buildSystemFieldDefaultShowIn();
    private static final java.util.Set<String> SYSTEM_FIELD_DEFAULT_PROFILE_EDITABLE = java.util.Set.of(
            "email",
            "phoneNumber",
            "address",
            "guardiansPhone",
            "guardianRelation",
            "schoolName",
            "schoolGrade",
            "universityName",
            "faculty",
            "universityGrade",
            "graduatedFrom",
            "graduateJob",
            "workDetails"
    );


    private final AuthService authService;
    private final AttendanceBackfillService attendanceBackfillService;
    private final FamilyCatalogService familyCatalogService;
    private final FamilyAccessService familyAccessService;
    private final UserFamilyRoleService userFamilyRoleService;
    private final CustomRegistrationFieldRepository customFieldRepo;
    private final CustomFieldValueRepository customFieldValueRepo;
    private final AttendanceAccessGrantService attendanceAccessGrantService;
    private final AttendanceConfigService attendanceConfigService;

    private record RegistrationRuleContext(
            boolean servant,
            String status,
            String studyType,
            String schoolGrade,
            String servingWhere,
            Boolean isWorking
    ) {}

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

        var visibleGrants = attendanceAccessGrantService.displayGrantsForUser(user.getId());
        out.put("activeAttendanceGrants", visibleGrants.stream().map(attendanceAccessGrantService::toView).toList());
        out.put("canOpenAttendance", !visibleGrants.isEmpty() || java.util.Set.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "DEVELOPER").contains(
                familyAccessService.normalizeRole(user.getRole())
        ));
        out.put("attendanceConfig", attendanceConfigService.getAttendanceConfig());

        return out;
    }


    @GetMapping("/custom-fields")
    public ResponseEntity<List<CustomRegistrationField>> publicCustomFields() {
        return ResponseEntity.ok(customFieldRepo.findAllByEnabledTrueOrderByDisplayOrderAsc());
    }

    @PostMapping("/register")
    public ResponseEntity<?> register(@Valid @RequestBody RegisterRequest request) {
        validateConfiguredRequirements(toFieldValueMap(request), false);
        User saved = authService.register(request);
        saveCustomFieldValues(saved, request.getCustomFields());
        return ResponseEntity.ok(Map.of("message", "User registered successfully"));
    }



    @PostMapping("/register-servant")
    public ResponseEntity<?> registerServant(@Valid @RequestBody RegisterServantRequest request) {
        validateConfiguredRequirements(toFieldValueMap(request), true);
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

        Map<String, CustomRegistrationField> editableProfileFields = new LinkedHashMap<>();
        for (CustomRegistrationField field : customFieldRepo.findAllByEnabledTrueOrderByDisplayOrderAsc()) {
            if (isProfileEditableField(field)) {
                editableProfileFields.put(field.getFieldKey(), field);
            }
        }

        if (updated.getEmail() != null && editableProfileFields.containsKey("email")) {
            String newEmail = updated.getEmail().trim();
            if (!newEmail.isBlank() && !newEmail.equalsIgnoreCase(existingUser.getEmail())) {
                if (authService.isEmailTakenByOther(newEmail, existingUser.getId())) {
                    throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "Email already in use");
                }
                existingUser.setEmail(newEmail);
            }
        }

        if (editableProfileFields.containsKey("phoneNumber")) {
            existingUser.setPhoneNumber(updated.getPhoneNumber());
        }
        if (editableProfileFields.containsKey("address")) {
            existingUser.setAddress(updated.getAddress());
        }
        if (editableProfileFields.containsKey("guardiansPhone")) {
            existingUser.setGuardiansPhone(updated.getGuardiansPhone());
        }
        if (editableProfileFields.containsKey("guardianRelation")) {
            existingUser.setGuardianRelation(updated.getGuardianRelation());
        }
        if (editableProfileFields.containsKey("deaconDegree")) {
            existingUser.setDeaconDegree(updated.getDeaconDegree());
        }
        if (editableProfileFields.containsKey("status")) {
            existingUser.setStatus(updated.getStatus());
        }
        if (editableProfileFields.containsKey("studyType")) {
            existingUser.setStudyType(updated.getStudyType());
        }
        if (editableProfileFields.containsKey("schoolName")) {
            existingUser.setSchoolName(updated.getSchoolName());
        }
        if (editableProfileFields.containsKey("schoolGrade")) {
            existingUser.setSchoolGrade(updated.getSchoolGrade());
        }
        if (editableProfileFields.containsKey("universityName")) {
            existingUser.setUniversityName(updated.getUniversityName());
        }
        if (editableProfileFields.containsKey("faculty")) {
            existingUser.setFaculty(updated.getFaculty());
        }
        if (editableProfileFields.containsKey("universityGrade")) {
            existingUser.setUniversityGrade(updated.getUniversityGrade());
        }
        if (editableProfileFields.containsKey("graduatedFrom")) {
            existingUser.setGraduatedFrom(updated.getGraduatedFrom());
        }
        if (editableProfileFields.containsKey("graduateJob")) {
            existingUser.setGraduateJob(updated.getGraduateJob());
        }
        if (editableProfileFields.containsKey("workDetails")) {
            existingUser.setWorkDetails(updated.getWorkDetails());
        }

        authService.saveUser(existingUser);
        updateProfileCustomFieldValues(existingUser, updated.getCustomFields(), editableProfileFields);

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

    private void updateProfileCustomFieldValues(
            User user,
            Map<String, String> customFields,
            Map<String, CustomRegistrationField> editableProfileFields
    ) {
        if (user == null || user.getId() == null || customFields == null || customFields.isEmpty()) {
            return;
        }

        for (var entry : customFields.entrySet()) {
            String key = safe(entry.getKey());
            if (key.isBlank()) {
                continue;
            }

            CustomRegistrationField field = editableProfileFields.get(key);
            if (field == null || Boolean.TRUE.equals(field.getIsSystem())) {
                continue;
            }

            String value = safe(entry.getValue());
            CustomFieldValue customFieldValue = customFieldValueRepo.findByUserIdAndFieldKey(user.getId(), key)
                    .orElseGet(() -> CustomFieldValue.builder()
                            .userId(user.getId())
                            .fieldKey(key)
                            .build());
            customFieldValue.setValue(value);
            customFieldValueRepo.save(customFieldValue);
        }
    }

    private void validateConfiguredRequirements(Map<String, String> values, boolean isServant) {
        RegistrationRuleContext context = buildRuleContext(values, isServant);
        Map<String, String> errors = new LinkedHashMap<>();

        for (CustomRegistrationField field : customFieldRepo.findAllByEnabledTrueOrderByDisplayOrderAsc()) {
            if (!isFieldVisibleForContext(field, context, values)) {
                continue;
            }
            if (!isFieldRequiredForContext(field, context)) {
                continue;
            }

            String raw = values.get(field.getFieldKey());
            if (raw != null && !raw.isBlank()) {
                continue;
            }

            String controlKey = Boolean.TRUE.equals(field.getIsSystem())
                    ? field.getFieldKey()
                    : "custom_" + field.getFieldKey();
            errors.put(controlKey, field.getLabelAr() + " يلزم");
        }

        if (!errors.isEmpty()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "CONFIG_REQUIRED_FIELDS",
                    "Some required fields are missing",
                    errors
            );
        }
    }

    private RegistrationRuleContext buildRuleContext(Map<String, String> values, boolean isServant) {
        return new RegistrationRuleContext(
                isServant,
                normalizeRuleValue(values.get("status")),
                normalizeRuleValue(values.get("studyType")),
                normalizeSchoolGradeRuleValue(values.get("schoolGrade")),
                values.getOrDefault("servingWhere", ""),
                parseBoolean(values.get("isWorking"))
        );
    }

    private boolean isFieldRequiredForContext(CustomRegistrationField field, RegistrationRuleContext context) {
        boolean alwaysRequired = Boolean.TRUE.equals(field.getRequired());
        boolean conditionalRequired = matchesAnyRule(field.getRequiredRule(), context);
        return alwaysRequired || conditionalRequired;
    }

    private boolean isFieldVisibleForContext(
            CustomRegistrationField field,
            RegistrationRuleContext context,
            Map<String, String> values
    ) {
        if (!matchesVisibilityConditions(field, context, values)) {
            return false;
        }
        if (!Boolean.TRUE.equals(field.getIsSystem())) {
            return true;
        }

        return switch (field.getFieldKey()) {
            case "deaconFamily", "khors" -> !context.servant();
            case "servingWhere" -> context.servant();
            case "attendKhors" -> context.servant() && context.servingWhere() != null && !context.servingWhere().isBlank();
            case "graduatedFrom", "graduateJob" -> "graduate".equals(context.status());
            case "studyType" -> "student".equals(context.status());
            case "schoolName", "schoolGrade" ->
                    "student".equals(context.status()) && "school".equals(context.studyType());
            case "otherGrade" ->
                    "student".equals(context.status())
                            && "school".equals(context.studyType())
                            && "other".equals(context.schoolGrade());
            case "universityName", "faculty", "universityGrade" ->
                    "student".equals(context.status()) && "university".equals(context.studyType());
            case "workDetails" -> Boolean.TRUE.equals(context.isWorking());
            default -> true;
        };
    }

    private boolean matchesVisibilityConditions(
            CustomRegistrationField field,
            RegistrationRuleContext context,
            Map<String, String> values
    ) {
        List<VisibilityConditionConfig> conditions = field.getVisibilityConditions();
        if (conditions == null || conditions.isEmpty()) {
            return matchesRule(field.getVisibilityRule(), context) && matchesVisibilityDependency(field, values);
        }

        for (VisibilityConditionConfig condition : conditions) {
            if (!matchesVisibilityCondition(condition, context, values)) {
                return false;
            }
        }

        return true;
    }

    private boolean matchesVisibilityCondition(
            VisibilityConditionConfig condition,
            RegistrationRuleContext context,
            Map<String, String> values
    ) {
        if (condition == null) {
            return true;
        }

        String type = safe(condition.getType()).toUpperCase(Locale.ROOT);
        if ("RULE".equals(type)) {
            return matchesRule(condition.getRule(), context);
        }

        if ("FIELD".equals(type)) {
            String fieldKey = safe(condition.getFieldKey());
            if (fieldKey.isBlank()) {
                return false;
            }

            List<String> valuesList = condition.getValues() == null ? List.of() : condition.getValues();
            if (valuesList.isEmpty()) {
                return false;
            }

            String currentValue = normalizeVisibilityDependencyValue(values.get(fieldKey));
            if (currentValue.isBlank()) {
                return false;
            }

            for (String expectedValue : valuesList) {
                if (normalizeVisibilityDependencyValue(expectedValue).equals(currentValue)) {
                    return true;
                }
            }
            return false;
        }

        return true;
    }

    private boolean matchesVisibilityDependency(CustomRegistrationField field, Map<String, String> values) {
        String dependsOn = safe(field.getVisibilityDependsOn());
        if (dependsOn.isBlank()) {
            return true;
        }

        String dependsValues = safe(field.getVisibilityDependsValues());
        if (dependsValues.isBlank()) {
            return false;
        }

        String currentValue = normalizeVisibilityDependencyValue(values.get(dependsOn));
        if (currentValue.isBlank()) {
            return false;
        }

        for (String rawExpected : dependsValues.split(",")) {
            if (normalizeVisibilityDependencyValue(rawExpected).equals(currentValue)) {
                return true;
            }
        }

        return false;
    }

    private String normalizeVisibilityDependencyValue(String value) {
        return value == null ? "" : value.trim().toLowerCase(Locale.ROOT);
    }

    private boolean matchesRule(String rule, RegistrationRuleContext context) {
        String normalized = (rule == null || rule.isBlank()) ? "ALWAYS" : rule.trim().toUpperCase(Locale.ROOT);
        return switch (normalized) {
            case "ALWAYS" -> true;
            case "NEVER" -> false;
            case "MEMBER_ONLY" -> !context.servant();
            case "SERVANT_ONLY" -> context.servant();
            case "STUDENT_ONLY" -> "student".equals(context.status());
            case "STUDENT_SCHOOL" -> "student".equals(context.status()) && "school".equals(context.studyType());
            case "STUDENT_UNIVERSITY" -> "student".equals(context.status()) && "university".equals(context.studyType());
            case "GRADUATE_ONLY" -> "graduate".equals(context.status());
            default -> false;
        };
    }

    private boolean matchesAnyRule(String rules, RegistrationRuleContext context) {
        if (rules == null || rules.isBlank()) {
            return false;
        }

        for (String rawRule : rules.split(",")) {
            String normalized = rawRule == null ? "" : rawRule.trim().toUpperCase(Locale.ROOT);
            if (normalized.isBlank() || "NEVER".equals(normalized)) {
                continue;
            }
            if (matchesRule(normalized, context)) {
                return true;
            }
        }

        return false;
    }

    private Map<String, String> toFieldValueMap(RegisterRequest request) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("fullName", safe(request.getFullName()));
        values.put("username", safe(request.getUsername()));
        values.put("phoneNumber", safe(request.getPhoneNumber()));
        values.put("address", safe(request.getAddress()));
        values.put("nationalId", safe(request.getNationalId()));
        values.put("email", safe(request.getEmail()));
        values.put("dateOfBirth", deriveDateOfBirth(request.getDateOfBirth(), request.getNationalId()));
        values.put("gender", deriveGender(request.getGender(), request.getNationalId()));
        values.put("deaconDegree", safe(request.getDeaconDegree()));
        values.put("deaconFamily", safe(request.getDeaconFamily()));
        values.put("khors", safe(request.getKhors()));
        values.put("servingWhere", "");
        values.put("attendKhors", "");
        values.put("status", safe(request.getStatus()));
        values.put("graduatedFrom", safe(request.getGraduatedFrom()));
        values.put("graduateJob", safe(request.getGraduateJob()));
        values.put("studyType", safe(request.getStudyType()));
        values.put("schoolName", safe(request.getSchoolName()));
        values.put("schoolGrade", safe(request.getSchoolGrade()));
        values.put("otherGrade", extractOtherGradeValue(request.getSchoolGrade()));
        values.put("universityName", safe(request.getUniversityName()));
        values.put("faculty", safe(request.getFaculty()));
        values.put("universityGrade", safe(request.getUniversityGrade()));
        values.put("isWorking", String.valueOf(request.getIsWorking()));
        values.put("workDetails", safe(request.getWorkDetails()));
        values.put("guardiansPhone", safe(request.getGuardiansPhone()));
        values.put("guardianRelation", safe(request.getGuardianRelation()));
        if (request.getCustomFields() != null) {
            request.getCustomFields().forEach((key, value) -> values.put(key, safe(value)));
        }
        return values;
    }

    private Map<String, String> toFieldValueMap(RegisterServantRequest request) {
        Map<String, String> values = new LinkedHashMap<>();
        values.put("fullName", safe(request.getFullName()));
        values.put("username", safe(request.getUsername()));
        values.put("phoneNumber", safe(request.getPhoneNumber()));
        values.put("address", safe(request.getAddress()));
        values.put("nationalId", safe(request.getNationalId()));
        values.put("email", safe(request.getEmail()));
        values.put("dateOfBirth", deriveDateOfBirth(request.getDateOfBirth(), request.getNationalId()));
        values.put("gender", deriveGender(request.getGender(), request.getNationalId()));
        values.put("deaconDegree", safe(request.getDeaconDegree()));
        values.put("deaconFamily", safe(request.getDeaconFamily()));
        values.put("khors", safe(request.getKhors()));
        values.put("servingWhere", safe(request.getDeaconFamily()));
        values.put("attendKhors", safe(request.getAttendKhors()));
        values.put("status", safe(request.getStatus()));
        values.put("graduatedFrom", safe(request.getGraduatedFrom()));
        values.put("graduateJob", safe(request.getGraduateJob()));
        values.put("studyType", safe(request.getStudyType()));
        values.put("schoolName", "");
        values.put("schoolGrade", "");
        values.put("otherGrade", "");
        values.put("universityName", safe(request.getUniversityName()));
        values.put("faculty", safe(request.getFaculty()));
        values.put("universityGrade", safe(request.getUniversityGrade()));
        values.put("isWorking", String.valueOf(request.getIsWorking()));
        values.put("workDetails", safe(request.getWorkDetails()));
        values.put("guardiansPhone", safe(request.getGuardiansPhone()));
        values.put("guardianRelation", safe(request.getGuardianRelation()));
        if (request.getCustomFields() != null) {
            request.getCustomFields().forEach((key, value) -> values.put(key, safe(value)));
        }
        return values;
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private String normalizeRuleValue(String value) {
        return safe(value).toLowerCase(Locale.ROOT);
    }

    private String normalizeSchoolGradeRuleValue(String value) {
        String normalized = normalizeRuleValue(value);
        if (normalized.isBlank()) {
            return "";
        }
        return KNOWN_SCHOOL_GRADES.contains(value == null ? "" : value.trim()) ? normalized : "other";
    }

    private String extractOtherGradeValue(String schoolGrade) {
        String safeGrade = safe(schoolGrade);
        if (safeGrade.isBlank() || KNOWN_SCHOOL_GRADES.contains(safeGrade)) {
            return "";
        }
        return safeGrade;
    }

    private Boolean parseBoolean(String value) {
        String normalized = safe(value).toLowerCase(Locale.ROOT);
        if (normalized.isBlank()) return null;
        if ("true".equals(normalized)) return true;
        if ("false".equals(normalized)) return false;
        return null;
    }

    private String deriveDateOfBirth(String rawDate, String nationalId) {
        String date = safe(rawDate);
        if (!date.isBlank()) {
            return date;
        }
        var derived = NationalIdUtils.extractBirthDate(safe(nationalId));
        return derived == null ? "" : derived.toString();
    }

    private String deriveGender(String rawGender, String nationalId) {
        String gender = safe(rawGender);
        if (!gender.isBlank()) {
            return gender;
        }
        String derived = NationalIdUtils.extractGender(safe(nationalId));
        return derived == null ? "" : derived;
    }

    private boolean isProfileEditableField(CustomRegistrationField field) {
        if (field == null || !Boolean.TRUE.equals(field.getEnabled())) {
            return false;
        }

        if (!effectiveShowInTargets(field).contains("PROFILE")) {
            return false;
        }

        Boolean configuredEditable = field.getProfileEditable();
        if (configuredEditable != null) {
            return configuredEditable;
        }

        return Boolean.TRUE.equals(field.getIsSystem())
                && SYSTEM_FIELD_DEFAULT_PROFILE_EDITABLE.contains(field.getFieldKey());
    }

    private java.util.Set<String> effectiveShowInTargets(CustomRegistrationField field) {
        if (field == null) {
            return java.util.Set.of();
        }

        java.util.Set<String> configuredTargets = parseShowInTargets(field.getShowIn());
        if (!configuredTargets.isEmpty()) {
            return configuredTargets;
        }

        if (Boolean.TRUE.equals(field.getIsSystem()) && !Boolean.TRUE.equals(field.getShowInConfigured())) {
            return SYSTEM_FIELD_DEFAULT_SHOW_IN.getOrDefault(field.getFieldKey(), java.util.Set.of());
        }

        return java.util.Set.of();
    }

    private java.util.Set<String> parseShowInTargets(String showIn) {
        java.util.LinkedHashSet<String> targets = new java.util.LinkedHashSet<>();
        for (String rawTarget : safe(showIn).split(",")) {
            String normalized = rawTarget.trim().toUpperCase(Locale.ROOT);
            if (!normalized.isBlank() && !"NONE".equals(normalized)) {
                targets.add(normalized);
            }
        }
        return targets;
    }

    private static java.util.Map<String, java.util.Set<String>> buildSystemFieldDefaultShowIn() {
        java.util.Map<String, java.util.Set<String>> defaults = new java.util.LinkedHashMap<>();
        defaults.put("fullName", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("username", java.util.Set.of("FAMILY_INFO"));
        defaults.put("email", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("phoneNumber", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("address", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("nationalId", java.util.Set.of("FAMILY_INFO"));
        defaults.put("dateOfBirth", java.util.Set.of("FAMILY_INFO"));
        defaults.put("gender", java.util.Set.of("FAMILY_INFO"));
        defaults.put("deaconDegree", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("deaconFamily", java.util.Set.of("FAMILY_INFO"));
        defaults.put("khors", java.util.Set.of("FAMILY_INFO"));
        defaults.put("status", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("studyType", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("schoolName", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("schoolGrade", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("universityName", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("faculty", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("universityGrade", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("graduatedFrom", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("graduateJob", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("isWorking", java.util.Set.of("FAMILY_INFO"));
        defaults.put("workDetails", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("guardiansPhone", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        defaults.put("guardianRelation", java.util.Set.of("PROFILE", "FAMILY_INFO"));
        return defaults;
    }
}
