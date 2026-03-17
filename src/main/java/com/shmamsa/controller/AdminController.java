
package com.shmamsa.controller;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.service.UserFamilyRoleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/admin")
@RequiredArgsConstructor
public class AdminController {

    private final UserRepository userRepo;
    private final UserFamilyRoleService userFamilyRoleService;

    private String authRole(Authentication auth) {
        if (auth == null || auth.getAuthorities() == null) return "MAKHDOM";
        return auth.getAuthorities().stream()
                .findFirst()
                .map(a -> a.getAuthority().replace("ROLE_", ""))
                .orElse("MAKHDOM");
    }

    public record ChangeRoleRequest(Long userId, String newRole) {}

    @PostMapping("/change-role")
    public ResponseEntity<?> changeRole(@RequestBody ChangeRoleRequest req, Authentication auth) {
        String actorRole = authRole(auth);
        if (!RoleUtil.canChangeRoles(actorRole)) {
            return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
        }

        if (req == null || req.userId() == null || req.newRole() == null || req.newRole().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "userId and newRole are required"));
        }

        String newRole = req.newRole().trim();

        if (!RoleUtil.ORDERED.contains(newRole)) {
            return ResponseEntity.badRequest().body(Map.of("error", "Invalid role"));
        }

        User target = userRepo.findById(req.userId()).orElse(null);
        if (target == null) return ResponseEntity.status(404).body(Map.of("error", "User not found"));

        // Restrictions:
        if ("DEVELOPER".equals(target.getRole())) {
            return ResponseEntity.status(403).body(Map.of("error", "Cannot change DEVELOPER role"));
        }
        if (!RoleUtil.canAssign(actorRole, newRole)) {
            return ResponseEntity.status(403).body(Map.of("error", "Not allowed to assign this role"));
        }


        target.setRole(newRole);
        if ("AMIN_KHEDMA".equalsIgnoreCase(newRole)) {
            target.setServingScope("KHORS_ONLY");
            userFamilyRoleService.replaceAssignments(target, List.of());
        }
        userRepo.save(target);

        return ResponseEntity.ok(Map.of("message", "Role updated", "userId", target.getId(), "role", target.getRole()));
    }

    @GetMapping("/roles")
    public ResponseEntity<?> roles(Authentication auth) {
        String actorRole = authRole(auth);
        List<String> allowed = RoleUtil.ORDERED.stream()
                .filter(r -> {
                    if ("DEVELOPER".equals(actorRole)) return true;
                    if ("AMIN_KHEDMA".equals(actorRole)) return !"DEVELOPER".equals(r);
                    return false;
                })
                .toList();
        return ResponseEntity.ok(allowed);
    }
}
