package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.ResourceFile;
import com.shmamsa.model.User;
import com.shmamsa.repository.ResourceFileRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.ResourceStorageService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import org.springframework.core.io.InputStreamResource;
import java.util.Locale;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/resources")
@RequiredArgsConstructor
public class ResourceController {

    private final ResourceFileRepository resourceRepo;
    private final UserRepository userRepo;
    private final FamilyAccessService familyAccessService;
    private final ResourceStorageService storage;

    private String folderKey(Long familyId, String familyName) {
        if ("ALL".equalsIgnoreCase(String.valueOf(familyName == null ? "" : familyName).trim())) return "ALL";
        return familyId == null ? "ALL" : String.valueOf(familyId);
    }

    private String normalizeCategory(String raw) {
        String value = raw == null ? "" : raw.trim().toUpperCase();
        if (value.equals("HYMNS") || value.equals("COPTIC") || value.equals("STUDIES")) return value;
        return "GENERAL";
    }

    private User requireUser(Authentication auth) {
        if (auth == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private String normRole(String raw) {
        if (raw == null) return "";
        String role = raw.trim().toUpperCase(Locale.ROOT);
        return role.startsWith("ROLE_") ? role.substring(5) : role;
    }

    private boolean isAdmin(User user) {
        String role = normRole(user == null ? null : user.getRole());
        return "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role) || "DEV".equals(role);
    }

    private String normalizeTargetFamily(String family) {
        String raw = String.valueOf(family == null ? "" : family).trim();
        if (raw.isBlank()) return "";
        if ("ALL".equalsIgnoreCase(raw)) return "ALL";
        return familyAccessService.baseNameForName(raw);
    }

    private boolean canViewFamily(User user, String family) {
        String target = normalizeTargetFamily(family);
        if (target.isBlank()) return false;
        if ("ALL".equalsIgnoreCase(target)) return isAdmin(user);
        return familyAccessService.belongsToBase(user, target);
    }

    private boolean canManageFamily(User user, String family) {
        String target = normalizeTargetFamily(family);
        if (target.isBlank()) return false;
        if ("ALL".equalsIgnoreCase(target)) return isAdmin(user);
        if (isAdmin(user)) return true;
        String scopedRole = familyAccessService.scopedRole(user, target);
        return scopedRole != null && ("KHADIM".equalsIgnoreCase(scopedRole)
                || "AMIN_OSRA".equalsIgnoreCase(scopedRole)
                || "AMIN_KHEDMA".equalsIgnoreCase(scopedRole));
    }

    private void assertCanViewResource(User user, ResourceFile resource) {
        if (!canViewFamily(user, resource == null ? null : resource.getFamily())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
    }

    private void assertCanManageResource(User user, ResourceFile resource) {
        if (!canManageFamily(user, resource == null ? null : resource.getFamily())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String family, Authentication auth) {
        User me = requireUser(auth);

        String target = (family != null && !family.isBlank()) ? family : familyAccessService.baseFamily(me);
        String normalizedTarget = normalizeTargetFamily(target);
        if (normalizedTarget.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        }
        if (!canViewFamily(me, normalizedTarget)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        if ("ALL".equalsIgnoreCase(normalizedTarget.trim())) {
            // Show everything when "ALL" is selected (admins want to review/edit global + family-specific uploads)
            return ResponseEntity.ok(resourceRepo.findAllByOrderByCreatedAtDesc());
        }

        List<Long> relatedIds = familyAccessService.relatedIdsForSelection(normalizedTarget);
        return ResponseEntity.ok(resourceRepo.findByFamilyIdInOrFamilyOrderByCreatedAtDesc(relatedIds, "ALL"));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "family", required = false) String family,
            @RequestParam(value = "category", required = false) String category,
            Authentication auth
    ) throws Exception {
        User me = requireUser(auth);

        String targetFamily = (family == null || family.isBlank()) ? familyAccessService.baseFamily(me) : family;
        String normalizedTargetFamily = normalizeTargetFamily(targetFamily);
        if (normalizedTargetFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        }
        if (!canManageFamily(me, normalizedTargetFamily)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        Long targetFamilyId = null;
        if (!"ALL".equalsIgnoreCase(normalizedTargetFamily.trim())) {
            targetFamily = normalizedTargetFamily;
            targetFamilyId = familyAccessService.familyIdForName(targetFamily);
        } else {
            targetFamily = "ALL";
        }

        var stored = storage.store(file, folderKey(targetFamilyId, targetFamily));

        ResourceFile rf = ResourceFile.builder()
                .title(title)
                .description(description)
                .originalName(stored.originalName)
                .storedName(stored.storedName)
                .contentType(stored.contentType)
                .size(stored.size)
                .family(targetFamily)
                .familyId(targetFamilyId)
                .category(normalizeCategory(category))
                .uploadedByUsername(me.getUsername())
                .build();

        return ResponseEntity.ok(resourceRepo.save(rf));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(
            @PathVariable Long id,
            @RequestParam("title") String title,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "family", required = false) String family,
            @RequestParam(value = "category", required = false) String category,
            @RequestParam(value = "file", required = false) MultipartFile file,
            Authentication auth
    ) throws Exception {
        User me = requireUser(auth);

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Resource not found"));
        assertCanManageResource(me, existing);

        String oldStoredName = existing.getStoredName();
        String oldFolderKey = folderKey(existing.getFamilyId(), existing.getFamily());

        String updatedFamily = family != null && !family.isBlank() ? normalizeTargetFamily(family) : existing.getFamily();
        if (updatedFamily == null || updatedFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        }
        if (!canManageFamily(me, updatedFamily)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
        Long updatedFamilyId = "ALL".equalsIgnoreCase(updatedFamily) ? null : familyAccessService.familyIdForName(updatedFamily);

        ResourceStorageService.StoredFileInfo uploaded = null;

        if (file != null && !file.isEmpty()) {
            uploaded = storage.store(file, folderKey(updatedFamilyId, updatedFamily));
        }

        existing.setTitle(title);
        existing.setDescription(description);
        existing.setCategory(normalizeCategory(category));
        existing.setFamily(updatedFamily);
        existing.setFamilyId(updatedFamilyId);

        if (uploaded != null) {
            existing.setStoredName(uploaded.storedName);
            existing.setOriginalName(uploaded.originalName);
            existing.setContentType(uploaded.contentType);
            existing.setSize(uploaded.size);
        }

        resourceRepo.save(existing);

        if (uploaded != null && oldStoredName != null && !oldStoredName.isBlank()) {
            storage.deletePhysical(oldFolderKey, oldStoredName);
        }

        return ResponseEntity.ok(existing);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "File not found"));
        assertCanManageResource(me, existing);

        storage.deletePhysical(folderKey(existing.getFamilyId(), existing.getFamily()), existing.getStoredName());

        resourceRepo.delete(existing);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<?> download(@PathVariable Long id, Authentication auth) throws Exception {
        User me = requireUser(auth);

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "File not found"));
        assertCanViewResource(me, existing);

        var stream = storage.download(existing.getStoredName());

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION,
                        "attachment; filename=\"" + existing.getOriginalName() + "\"")
                .contentType(MediaType.parseMediaType(
                        existing.getContentType() == null ? "application/octet-stream" : existing.getContentType()
                ))
                .body(new InputStreamResource(stream));
    }
}
