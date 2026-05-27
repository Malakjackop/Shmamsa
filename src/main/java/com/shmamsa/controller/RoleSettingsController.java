package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.RoleSettings;
import com.shmamsa.service.RoleSettingsService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dev/roles")
@RequiredArgsConstructor
public class RoleSettingsController {

    private final RoleSettingsService roleSettingsService;

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

    @GetMapping
    public ResponseEntity<List<RoleSettings>> getAll(Authentication auth) {
        ensureDeveloper(auth);
        return ResponseEntity.ok(roleSettingsService.findAll());
    }

    @GetMapping("/permissions")
    public ResponseEntity<List<String>> getAllPermissions(Authentication auth) {
        ensureDeveloper(auth);
        return ResponseEntity.ok(RoleSettingsService.ALL_PERMISSIONS);
    }

    public record CreateRoleRequest(String name, String displayNameAr, String permissions) {}

    @PostMapping
    public ResponseEntity<?> create(@RequestBody CreateRoleRequest req, Authentication auth) {
        ensureDeveloper(auth);

        if (req.name() == null || req.name().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NAME_REQUIRED", "Role name is required");
        }

        String normalizedName = req.name().trim().toUpperCase();
        if (!normalizedName.matches("[A-Z][A-Z0-9_]*")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_NAME", "Role name must be uppercase letters, numbers, and underscores");
        }

        RoleSettings role = roleSettingsService.create(normalizedName, req.displayNameAr(), req.permissions());
        return ResponseEntity.ok(role);
    }

    public record UpdateRoleRequest(String displayNameAr, Boolean active, String permissions) {}

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody UpdateRoleRequest req, Authentication auth) {
        ensureDeveloper(auth);
        RoleSettings role = roleSettingsService.update(id, req.displayNameAr(), req.active(), req.permissions());
        return ResponseEntity.ok(role);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        ensureDeveloper(auth);
        roleSettingsService.delete(id);
        return ResponseEntity.ok(Map.of("message", "Role deleted", "id", id));
    }

    public record ReorderRequest(List<Long> ids) {}

    @PutMapping("/reorder")
    public ResponseEntity<?> reorder(@RequestBody ReorderRequest req, Authentication auth) {
        ensureDeveloper(auth);
        roleSettingsService.reorder(req.ids());
        return ResponseEntity.ok(Map.of("message", "Order updated"));
    }
}
