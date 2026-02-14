package com.shmamsa.controller;

import com.shmamsa.model.ResourceFile;
import com.shmamsa.model.User;
import com.shmamsa.repository.ResourceFileRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.service.ResourceStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.*;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Path;
import java.util.*;

@RestController
@RequestMapping("/api/resources")
@RequiredArgsConstructor
public class ResourceController {

    private final ResourceFileRepository resourceRepo;
    private final UserRepository userRepo;
    private final ResourceStorageService storage;

    private String authRole(Authentication auth) {
        if (auth == null || auth.getAuthorities() == null) return "MAKHDOM";
        return auth.getAuthorities().stream()
                .findFirst()
                .map(a -> a.getAuthority().replace("ROLE_", ""))
                .orElse("MAKHDOM");
    }

    private User authedUser(Authentication auth) {
        if (auth == null) return null;
        String username = String.valueOf(auth.getPrincipal());
        return userRepo.findByUsername(username).orElse(null);
    }

    private boolean isUploaderOrAbove(String role) {
        return RoleUtil.isAtLeast(role, "KHADIM");
    }


    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String family, Authentication auth) {
        String role = authRole(auth);
        User me = authedUser(auth);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        if (RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            if (family == null || family.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "family is required"));
            }
            String f = family.trim();
            if ("ALL".equalsIgnoreCase(f)) {
                return ResponseEntity.ok(List.of());
            }
            return ResponseEntity.ok(resourceRepo.findByFamilyInOrderByCreatedAtDesc(List.of(f, "ALL")));
        }

        String myFamily = me.getDeaconFamily();
        return ResponseEntity.ok(resourceRepo.findByFamilyInOrderByCreatedAtDesc(List.of(myFamily, "ALL")));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String description,
            @RequestParam(required = false) String family,
            Authentication auth
    ) throws IOException {

        String role = authRole(auth);
        User me = authedUser(auth);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        if (!isUploaderOrAbove(role)) {
            return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
        }

        String targetFamily;

        if (!RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            targetFamily = me.getDeaconFamily();
        } else {
            if (family == null || family.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "family is required"));
            }
            targetFamily = family.trim();
            if (targetFamily.equalsIgnoreCase("ALL")) targetFamily = "ALL";
        }

        var stored = storage.store(file, targetFamily);

        ResourceFile rf = ResourceFile.builder()
                .title(title)
                .description(description)
                .originalName(stored.originalName)
                .storedName(stored.storedName)
                .contentType(stored.contentType)
                .size(stored.size)
                .family(targetFamily)
                .uploadedByUsername(me.getUsername())
                .build();

        rf = resourceRepo.save(rf);
        return ResponseEntity.ok(rf);
    }

    @PutMapping(value = "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> update(
            @PathVariable Long id,
            @RequestParam(required = false) String title,
            @RequestParam(required = false) String description,
            @RequestParam(required = false) MultipartFile file,
            Authentication auth
    ) throws IOException {

        String role = authRole(auth);
        User me = authedUser(auth);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        if (!isUploaderOrAbove(role)) return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));

        ResourceFile rf = resourceRepo.findById(id).orElse(null);
        if (rf == null) return ResponseEntity.status(404).body(Map.of("error", "Not found"));

        if (!RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            if (!Objects.equals(rf.getFamily(), me.getDeaconFamily())) {
                return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
            }
        }

        if (title != null) rf.setTitle(title);
        if (description != null) rf.setDescription(description);

        if (file != null && !file.isEmpty()) {
            storage.deletePhysical(rf.getFamily(), rf.getStoredName());

            var stored = storage.store(file, rf.getFamily());
            rf.setOriginalName(stored.originalName);
            rf.setStoredName(stored.storedName);
            rf.setContentType(stored.contentType);
            rf.setSize(stored.size);
        }

        rf = resourceRepo.save(rf);
        return ResponseEntity.ok(rf);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        String role = authRole(auth);
        User me = authedUser(auth);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        if (!isUploaderOrAbove(role)) return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));

        ResourceFile rf = resourceRepo.findById(id).orElse(null);
        if (rf == null) return ResponseEntity.status(404).body(Map.of("error", "Not found"));

        if (!RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            if (!Objects.equals(rf.getFamily(), me.getDeaconFamily())) {
                return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
            }
        }

        storage.deletePhysical(rf.getFamily(), rf.getStoredName());
        resourceRepo.delete(rf);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<?> download(@PathVariable Long id, Authentication auth) {
        String role = authRole(auth);
        User me = authedUser(auth);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        ResourceFile rf = resourceRepo.findById(id).orElse(null);
        if (rf == null) return ResponseEntity.status(404).body(Map.of("error", "Not found"));

        boolean canSee = "ALL".equalsIgnoreCase(rf.getFamily())
                || Objects.equals(rf.getFamily(), me.getDeaconFamily())
                || RoleUtil.isAtLeast(role, "AMIN_KHEDMA");

        if (!canSee) return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));

        Path path = storage.resolvePath(rf.getFamily(), rf.getStoredName());
        Resource fileRes = new FileSystemResource(path.toFile());
        if (!fileRes.exists()) return ResponseEntity.status(404).body(Map.of("error", "File missing"));

        String ct = rf.getContentType() != null ? rf.getContentType() : "application/octet-stream";

        return ResponseEntity.ok()
                .contentType(MediaType.parseMediaType(ct))
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + rf.getOriginalName().replace("\"", "") + "\"")
                .body(fileRes);
    }
}
