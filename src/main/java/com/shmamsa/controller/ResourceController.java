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

import java.nio.file.Files;
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

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me =userRepo.findByUsername(auth.getName()).orElse(null);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        String target = (family != null && !family.isBlank()) ? family : familyAccessService.baseFamily(me);

        if ("ALL".equalsIgnoreCase(target.trim())) {
            // Show everything when "ALL" is selected (admins want to review/edit global + family-specific uploads)
            return ResponseEntity.ok(resourceRepo.findAllByOrderByCreatedAtDesc());
        }

        List<Long> relatedIds = familyAccessService.relatedIdsForSelection(target);
        return ResponseEntity.ok(resourceRepo.findByFamilyIdInOrFamilyOrderByCreatedAtDesc(relatedIds, "ALL"));
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> upload(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "family", required = false) String family,
            Authentication auth
    ) throws Exception {

        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElse(null);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        String targetFamily = (family == null || family.isBlank()) ? familyAccessService.baseFamily(me) : family;

        Long targetFamilyId = null;
        if (!"ALL".equalsIgnoreCase(targetFamily.trim())) {
            targetFamily = familyAccessService.baseNameForName(targetFamily);
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
                .uploadedByUsername(me.getUsername())
                .build();

        return ResponseEntity.ok(resourceRepo.save(rf));
    }

    @PutMapping(value = "/{id}", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<?> update(
            @PathVariable Long id,
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "title", required = false) String title,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "family", required = false) String family,
            Authentication auth
    ) throws Exception {

        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "File not found"));

        if (title != null) existing.setTitle(title);
        if (description != null) existing.setDescription(description);

        if (family != null && !family.isBlank()) {
            if ("ALL".equalsIgnoreCase(family.trim())) {
                existing.setFamily("ALL");
                existing.setFamilyId(null);
            } else {
                String base = familyAccessService.baseNameForName(family);
                existing.setFamily(base);
                existing.setFamilyId(familyAccessService.familyIdForName(base));
            }
        }

        if (file != null && !file.isEmpty()) {
            storage.deletePhysical(folderKey(existing.getFamilyId(), existing.getFamily()), existing.getStoredName());

            var stored = storage.store(file, folderKey(existing.getFamilyId(), existing.getFamily()));

            existing.setOriginalName(stored.originalName);
            existing.setStoredName(stored.storedName);
            existing.setContentType(stored.contentType);
            existing.setSize(stored.size);
        }

        return ResponseEntity.ok(resourceRepo.save(existing));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "File not found"));

        storage.deletePhysical(folderKey(existing.getFamilyId(), existing.getFamily()), existing.getStoredName());

        resourceRepo.delete(existing);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<?> download(@PathVariable Long id) throws Exception {

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "File not found"));

        var path = storage.resolvePath(folderKey(existing.getFamilyId(), existing.getFamily()), existing.getStoredName());
        if (!Files.exists(path)) throw new ApiException(HttpStatus.NOT_FOUND, "Stored file missing");

        var bytes = Files.readAllBytes(path);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + existing.getOriginalName() + "\"")
                .contentType(MediaType.parseMediaType(existing.getContentType() == null ? "application/octet-stream" : existing.getContentType()))
                .body(bytes);
    }
}
