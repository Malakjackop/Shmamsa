package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.CustomRegistrationField;
import com.shmamsa.model.VisibilityConditionConfig;
import com.shmamsa.repository.CustomFieldValueRepository;
import com.shmamsa.repository.CustomRegistrationFieldRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

@RestController
@RequestMapping("/api/dev")
@RequiredArgsConstructor
public class DevSettingsController {

    private static final List<String> ALLOWED_REQUIRED_RULES = List.of(
            "NEVER",
            "MEMBER_ONLY",
            "SERVANT_ONLY",
            "STUDENT_ONLY",
            "STUDENT_SCHOOL",
            "STUDENT_UNIVERSITY",
            "GRADUATE_ONLY"
    );
    private static final List<String> ALLOWED_VISIBILITY_CONDITION_RULES = List.of(
            "NEVER",
            "MEMBER_ONLY",
            "SERVANT_ONLY",
            "STUDENT_ONLY",
            "STUDENT_SCHOOL",
            "STUDENT_UNIVERSITY",
            "GRADUATE_ONLY"
    );
    private static final List<String> SHOW_IN_TARGET_ORDER = List.of("FAMILY_INFO", "PROFILE");
    private static final Set<String> ALLOWED_SHOW_IN_TARGETS = Set.of("NONE", "FAMILY_INFO", "PROFILE");

    private final CustomRegistrationFieldRepository fieldRepo;
    private final CustomFieldValueRepository valueRepo;

    // ── helpers ──────────────────────────────────────────────────────────
    private void ensureDeveloper(Authentication auth) {
        if (auth == null || auth.getAuthorities() == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Developer access only");
        }
        boolean isDev = auth.getAuthorities().stream()
                .anyMatch(a -> {
                    String role = a.getAuthority().replace("ROLE_", "");
                    return "DEVELOPER".equalsIgnoreCase(role);
                });
        if (!isDev) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Developer access only");
        }
    }

    private String normalizeRequiredRuleSet(String rules) {
        if (rules == null || rules.isBlank()) {
            return "NEVER";
        }

        LinkedHashSet<String> normalizedRules = new LinkedHashSet<>();
        for (String rawRule : rules.split(",")) {
            String normalized = rawRule == null ? "" : rawRule.trim().toUpperCase(Locale.ROOT);
            if (normalized.isBlank()) {
                continue;
            }
            if (!ALLOWED_REQUIRED_RULES.contains(normalized)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_REQUIRED_RULE", "Required rule is invalid");
            }
            if (!"NEVER".equals(normalized)) {
                normalizedRules.add(normalized);
            }
        }

        if (normalizedRules.isEmpty()) {
            return "NEVER";
        }

        return String.join(",", normalizedRules);
    }

    private String normalizeShowIn(String showIn) {
        if (showIn == null || showIn.isBlank()) {
            return "NONE";
        }

        LinkedHashSet<String> normalizedTargets = new LinkedHashSet<>();
        for (String rawTarget : showIn.split(",")) {
            String normalized = rawTarget == null ? "" : rawTarget.trim().toUpperCase(Locale.ROOT);
            if (normalized.isBlank()) {
                continue;
            }
            if (!ALLOWED_SHOW_IN_TARGETS.contains(normalized)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SHOW_IN", "Show-in target is invalid");
            }
            if (!"NONE".equals(normalized)) {
                normalizedTargets.add(normalized);
            }
        }

        if (normalizedTargets.isEmpty()) {
            return "NONE";
        }

        List<String> orderedTargets = new ArrayList<>();
        for (String target : SHOW_IN_TARGET_ORDER) {
            if (normalizedTargets.contains(target)) {
                orderedTargets.add(target);
            }
        }

        return orderedTargets.isEmpty() ? "NONE" : String.join(",", orderedTargets);
    }

    // ── GET all fields ──────────────────────────────────────────────────
    @GetMapping("/custom-fields")
    public ResponseEntity<List<CustomRegistrationField>> getAll(Authentication auth) {
        ensureDeveloper(auth);
        return ResponseEntity.ok(fieldRepo.findAllByOrderByDisplayOrderAsc());
    }

    // ── CREATE ──────────────────────────────────────────────────────────
    public record VisibilityConditionRequest(
            String type,
            String rule,
            String fieldKey,
            List<String> values
    ) {}

    public record CreateFieldRequest(
            String fieldKey,
            String labelAr,
            String fieldType,
            String options,
            Boolean required,
            String requiredRule,
            List<VisibilityConditionRequest> visibilityConditions,
            String visibilityRule,
            String visibilityDependsOn,
            String visibilityDependsValues,
            String showIn,
            Integer displayOrder
    ) {}

    @PostMapping("/custom-fields")
    public ResponseEntity<?> create(@RequestBody CreateFieldRequest req, Authentication auth) {
        ensureDeveloper(auth);

        if (req.fieldKey() == null || req.fieldKey().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "FIELD_KEY_REQUIRED", "Field key is required");
        }
        if (req.labelAr() == null || req.labelAr().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "LABEL_REQUIRED", "Arabic label is required");
        }

        String key = req.fieldKey().trim().replaceAll("[^a-zA-Z0-9_]", "");
        if (key.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_KEY", "Field key must be alphanumeric/underscores");
        }

        if (fieldRepo.existsByFieldKey(key)) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_KEY", "Field key already exists");
        }

        String type = (req.fieldType() == null || req.fieldType().isBlank()) ? "TEXT" : req.fieldType().trim().toUpperCase();
        if (!List.of("TEXT", "SELECT").contains(type)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TYPE", "Type must be TEXT or SELECT");
        }
        String requiredRule = normalizeRequiredRuleSet(req.requiredRule());
        String showIn = normalizeShowIn(req.showIn());
        List<VisibilityConditionConfig> visibilityConditions = req.visibilityConditions() != null
                ? normalizeVisibilityConditions(key, req.visibilityConditions())
                : null;

        CustomRegistrationField field = CustomRegistrationField.builder()
                .fieldKey(key)
                .labelAr(req.labelAr().trim())
                .fieldType(type)
                .options("SELECT".equals(type) ? (req.options() != null ? req.options().trim() : "") : null)
                .required(req.required() != null && req.required())
                .requiredRule(requiredRule)
                .showIn(showIn)
                .displayOrder(req.displayOrder() != null ? req.displayOrder() : 0)
                .enabled(true)
                .createdAt(LocalDateTime.now())
                .build();

        applyVisibilityConfiguration(field, key, visibilityConditions, req.visibilityRule(), req.visibilityDependsOn(), req.visibilityDependsValues());
        fieldRepo.save(field);
        return ResponseEntity.ok(field);
    }

    // ── UPDATE ──────────────────────────────────────────────────────────
    public record UpdateFieldRequest(
            String labelAr,
            String fieldType,
            String options,
            Boolean required,
            String requiredRule,
            List<VisibilityConditionRequest> visibilityConditions,
            String visibilityRule,
            String visibilityDependsOn,
            String visibilityDependsValues,
            String showIn,
            Integer displayOrder
    ) {}

    @PutMapping("/custom-fields/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody UpdateFieldRequest req, Authentication auth) {
        ensureDeveloper(auth);

        CustomRegistrationField field = fieldRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Field not found"));

        if (req.labelAr() != null && !req.labelAr().isBlank()) {
            field.setLabelAr(req.labelAr().trim());
        }

        if (req.fieldType() != null && !req.fieldType().isBlank()) {
            String type = req.fieldType().trim().toUpperCase();
            if (!List.of("TEXT", "SELECT").contains(type)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TYPE", "Type must be TEXT or SELECT");
            }
            field.setFieldType(type);
        }

        if (req.options() != null) {
            field.setOptions(req.options().trim());
        }
        if (req.required() != null) {
            field.setRequired(req.required());
        }
        if (req.requiredRule() != null) {
            field.setRequiredRule(normalizeRequiredRuleSet(req.requiredRule()));
        }
        if (req.visibilityConditions() != null || req.visibilityRule() != null || req.visibilityDependsOn() != null || req.visibilityDependsValues() != null) {
            applyVisibilityConfiguration(
                    field,
                    field.getFieldKey(),
                    req.visibilityConditions() != null
                            ? normalizeVisibilityConditions(field.getFieldKey(), req.visibilityConditions())
                            : null,
                    req.visibilityRule(),
                    req.visibilityDependsOn(),
                    req.visibilityDependsValues()
            );
        }
        if (req.showIn() != null && !req.showIn().isBlank()) {
            field.setShowIn(normalizeShowIn(req.showIn()));
        }
        if (req.displayOrder() != null) {
            field.setDisplayOrder(req.displayOrder());
        }

        fieldRepo.save(field);
        return ResponseEntity.ok(field);
    }

    private void applyVisibilityConfiguration(
            CustomRegistrationField field,
            String currentFieldKey,
            List<VisibilityConditionConfig> visibilityConditions,
            String legacyVisibilityRule,
            String legacyVisibilityDependsOn,
            String legacyVisibilityDependsValues
    ) {
        List<VisibilityConditionConfig> normalizedConditions = visibilityConditions != null
                ? visibilityConditions
                : buildVisibilityConditionsFromLegacy(currentFieldKey, legacyVisibilityRule, legacyVisibilityDependsOn, legacyVisibilityDependsValues);

        field.setVisibilityConditions(normalizedConditions);
        field.setVisibilityRule(resolveLegacyVisibilityRule(normalizedConditions, legacyVisibilityRule));
        field.setVisibilityDependsOn(resolveLegacyVisibilityDependsOn(normalizedConditions, legacyVisibilityDependsOn));
        field.setVisibilityDependsValues(resolveLegacyVisibilityDependsValues(normalizedConditions, legacyVisibilityDependsValues));

        // Re-validate the derived legacy field condition against the current field key.
        String legacyDependsOn = field.getVisibilityDependsOn();
        if (legacyDependsOn != null && legacyDependsOn.equalsIgnoreCase(currentFieldKey)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_VISIBILITY_DEPENDENCY",
                    "Field cannot depend on itself for visibility"
            );
        }
    }

    private List<VisibilityConditionConfig> buildVisibilityConditionsFromLegacy(
            String currentFieldKey,
            String legacyVisibilityRule,
            String legacyVisibilityDependsOn,
            String legacyVisibilityDependsValues
    ) {
        List<VisibilityConditionConfig> conditions = new ArrayList<>();

        String normalizedRule = normalizeSingleLegacyVisibilityRule(legacyVisibilityRule);
        if (!"ALWAYS".equals(normalizedRule)) {
            conditions.add(
                    VisibilityConditionConfig.builder()
                            .type("RULE")
                            .rule(normalizedRule)
                            .build()
            );
        }

        String normalizedDependsOn = normalizeFieldReference(legacyVisibilityDependsOn);
        String normalizedDependsValues = normalizeDelimitedValues(legacyVisibilityDependsValues);
        if (normalizedDependsOn != null || normalizedDependsValues != null) {
            if (normalizedDependsOn == null) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "VISIBILITY_DEPENDENCY_FIELD_REQUIRED",
                        "Visibility dependency field is required"
                );
            }
            if (normalizedDependsOn.equalsIgnoreCase(currentFieldKey)) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_VISIBILITY_DEPENDENCY",
                        "Field cannot depend on itself for visibility"
                );
            }
            if (!fieldRepo.existsByFieldKey(normalizedDependsOn)) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "VISIBILITY_DEPENDENCY_NOT_FOUND",
                        "Visibility dependency field was not found"
                );
            }
            if (normalizedDependsValues == null) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "VISIBILITY_DEPENDENCY_VALUES_REQUIRED",
                        "Visibility dependency values are required"
                );
            }

            conditions.add(
                    VisibilityConditionConfig.builder()
                            .type("FIELD")
                            .fieldKey(normalizedDependsOn)
                            .values(List.of(normalizedDependsValues.split(",")))
                            .build()
            );
        }

        return conditions;
    }

    private List<VisibilityConditionConfig> normalizeVisibilityConditions(
            String currentFieldKey,
            List<VisibilityConditionRequest> rawConditions
    ) {
        if (rawConditions == null || rawConditions.isEmpty()) {
            return List.of();
        }

        LinkedHashSet<String> seen = new LinkedHashSet<>();
        List<VisibilityConditionConfig> normalizedConditions = new ArrayList<>();

        for (VisibilityConditionRequest rawCondition : rawConditions) {
            if (rawCondition == null) {
                continue;
            }

            String type = rawCondition.type() == null ? "" : rawCondition.type().trim().toUpperCase(Locale.ROOT);
            if ("RULE".equals(type)) {
                String normalizedRule = normalizeVisibilityConditionRule(rawCondition.rule());
                VisibilityConditionConfig condition = VisibilityConditionConfig.builder()
                        .type("RULE")
                        .rule(normalizedRule)
                        .build();
                String signature = "RULE:" + normalizedRule;
                if (seen.add(signature)) {
                    normalizedConditions.add(condition);
                }
                continue;
            }

            if (!"FIELD".equals(type)) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_VISIBILITY_CONDITION_TYPE",
                        "Visibility condition type is invalid"
                );
            }

            String normalizedDependsOn = normalizeFieldReference(rawCondition.fieldKey());
            if (normalizedDependsOn == null) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "VISIBILITY_DEPENDENCY_FIELD_REQUIRED",
                        "Visibility dependency field is required"
                );
            }
            if (normalizedDependsOn.equalsIgnoreCase(currentFieldKey)) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "INVALID_VISIBILITY_DEPENDENCY",
                        "Field cannot depend on itself for visibility"
                );
            }
            if (!fieldRepo.existsByFieldKey(normalizedDependsOn)) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "VISIBILITY_DEPENDENCY_NOT_FOUND",
                        "Visibility dependency field was not found"
                );
            }

            String normalizedDependsValues = normalizeDelimitedValues(rawCondition.values());
            if (normalizedDependsValues == null) {
                throw new ApiException(
                        HttpStatus.BAD_REQUEST,
                        "VISIBILITY_DEPENDENCY_VALUES_REQUIRED",
                        "Visibility dependency values are required"
                );
            }

            VisibilityConditionConfig condition = VisibilityConditionConfig.builder()
                    .type("FIELD")
                    .fieldKey(normalizedDependsOn)
                    .values(List.of(normalizedDependsValues.split(",")))
                    .build();
            String signature = "FIELD:" + normalizedDependsOn + ":" + normalizedDependsValues;
            if (seen.add(signature)) {
                normalizedConditions.add(condition);
            }
        }

        return normalizedConditions;
    }

    private String normalizeVisibilityConditionRule(String rule) {
        String normalized = rule == null ? "" : rule.trim().toUpperCase(Locale.ROOT);
        if (!ALLOWED_VISIBILITY_CONDITION_RULES.contains(normalized)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_VISIBILITY_RULE",
                    "Visibility rule is invalid"
            );
        }
        return normalized;
    }

    private String resolveLegacyVisibilityRule(List<VisibilityConditionConfig> conditions, String fallbackRule) {
        for (VisibilityConditionConfig condition : conditions) {
            if (condition != null && "RULE".equalsIgnoreCase(condition.getType())) {
                return normalizeVisibilityConditionRule(condition.getRule());
            }
        }

        return normalizeSingleLegacyVisibilityRule(fallbackRule);
    }

    private String resolveLegacyVisibilityDependsOn(List<VisibilityConditionConfig> conditions, String fallbackDependsOn) {
        for (VisibilityConditionConfig condition : conditions) {
            if (condition != null && "FIELD".equalsIgnoreCase(condition.getType())) {
                return normalizeFieldReference(condition.getFieldKey());
            }
        }

        return normalizeFieldReference(fallbackDependsOn);
    }

    private String resolveLegacyVisibilityDependsValues(List<VisibilityConditionConfig> conditions, String fallbackDependsValues) {
        for (VisibilityConditionConfig condition : conditions) {
            if (condition != null && "FIELD".equalsIgnoreCase(condition.getType())) {
                return normalizeDelimitedValues(condition.getValues());
            }
        }

        return normalizeDelimitedValues(fallbackDependsValues);
    }

    private String normalizeSingleLegacyVisibilityRule(String rule) {
        if (rule == null || rule.isBlank()) {
            return "ALWAYS";
        }

        String normalized = rule.trim().toUpperCase(Locale.ROOT);
        if ("ALWAYS".equals(normalized)) {
            return "ALWAYS";
        }
        if ("NEVER".equals(normalized)) {
            return "NEVER";
        }
        if (!ALLOWED_VISIBILITY_CONDITION_RULES.contains(normalized)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_VISIBILITY_RULE",
                    "Visibility rule is invalid"
            );
        }
        return normalized;
    }

    private String normalizeFieldReference(String fieldKey) {
        if (fieldKey == null || fieldKey.isBlank()) {
            return null;
        }

        String normalized = fieldKey.trim();
        if (!normalized.matches("[a-zA-Z0-9_]+")) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FIELD_REFERENCE",
                    "Referenced field key must be alphanumeric/underscores"
            );
        }

        return normalized;
    }

    private String normalizeDelimitedValues(String rawValues) {
        if (rawValues == null || rawValues.isBlank()) {
            return null;
        }

        LinkedHashSet<String> normalizedValues = new LinkedHashSet<>();
        for (String rawValue : rawValues.split(",")) {
            String normalized = rawValue == null ? "" : rawValue.trim();
            if (!normalized.isBlank()) {
                normalizedValues.add(normalized);
            }
        }

        if (normalizedValues.isEmpty()) {
            return null;
        }

        return String.join(",", normalizedValues);
    }

    private String normalizeDelimitedValues(List<String> rawValues) {
        if (rawValues == null || rawValues.isEmpty()) {
            return null;
        }

        LinkedHashSet<String> normalizedValues = new LinkedHashSet<>();
        for (String rawValue : rawValues) {
            String normalized = rawValue == null ? "" : rawValue.trim();
            if (!normalized.isBlank()) {
                normalizedValues.add(normalized);
            }
        }

        if (normalizedValues.isEmpty()) {
            return null;
        }

        return String.join(",", normalizedValues);
    }

    // ── TOGGLE enable / disable ─────────────────────────────────────────
    @PutMapping("/custom-fields/{id}/toggle")
    public ResponseEntity<?> toggle(@PathVariable Long id, Authentication auth) {
        ensureDeveloper(auth);

        CustomRegistrationField field = fieldRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Field not found"));

        field.setEnabled(!field.getEnabled());
        fieldRepo.save(field);

        return ResponseEntity.ok(Map.of("id", field.getId(), "enabled", field.getEnabled()));
    }

    // ── DELETE ───────────────────────────────────────────────────────────
    @Transactional
    @DeleteMapping("/custom-fields/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        ensureDeveloper(auth);

        CustomRegistrationField field = fieldRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Field not found"));

        // delete all stored values for this field
        valueRepo.deleteAllByFieldKey(field.getFieldKey());
        fieldRepo.delete(field);

        return ResponseEntity.ok(Map.of("message", "Field deleted", "fieldKey", field.getFieldKey()));
    }
}
