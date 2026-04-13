package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.CustomRegistrationField;
import com.shmamsa.repository.CustomFieldValueRepository;
import com.shmamsa.repository.CustomRegistrationFieldRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dev")
@RequiredArgsConstructor
public class DevSettingsController {

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

    // ── GET all fields ──────────────────────────────────────────────────
    @GetMapping("/custom-fields")
    public ResponseEntity<List<CustomRegistrationField>> getAll(Authentication auth) {
        ensureDeveloper(auth);
        return ResponseEntity.ok(fieldRepo.findAllByOrderByDisplayOrderAsc());
    }

    // ── CREATE ──────────────────────────────────────────────────────────
    public record CreateFieldRequest(
            String fieldKey,
            String labelAr,
            String fieldType,
            String options,
            Boolean required,
            String visibilityRule,
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

        CustomRegistrationField field = CustomRegistrationField.builder()
                .fieldKey(key)
                .labelAr(req.labelAr().trim())
                .fieldType(type)
                .options("SELECT".equals(type) ? (req.options() != null ? req.options().trim() : "") : null)
                .required(req.required() != null && req.required())
                .visibilityRule(req.visibilityRule() != null ? req.visibilityRule().trim() : "ALWAYS")
                .showIn(req.showIn() != null ? req.showIn().trim() : "NONE")
                .displayOrder(req.displayOrder() != null ? req.displayOrder() : 0)
                .enabled(true)
                .createdAt(LocalDateTime.now())
                .build();

        fieldRepo.save(field);
        return ResponseEntity.ok(field);
    }

    // ── UPDATE ──────────────────────────────────────────────────────────
    public record UpdateFieldRequest(
            String labelAr,
            String fieldType,
            String options,
            Boolean required,
            String visibilityRule,
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
        if (req.visibilityRule() != null && !req.visibilityRule().isBlank()) {
            field.setVisibilityRule(req.visibilityRule().trim());
        }
        if (req.showIn() != null && !req.showIn().isBlank()) {
            field.setShowIn(req.showIn().trim());
        }
        if (req.displayOrder() != null) {
            field.setDisplayOrder(req.displayOrder());
        }

        fieldRepo.save(field);
        return ResponseEntity.ok(field);
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
