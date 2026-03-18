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

    @PutMapping("/{id}")
    public ResponseEntity<?> update(
            @PathVariable Long id,
            @RequestParam("title") String title,
            @RequestParam(value = "description", required = false) String description,
            @RequestParam(value = "family", required = false) String family,
            @RequestParam(value = "file", required = false) MultipartFile file
    ) throws Exception {

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Resource not found"));

        String oldStoredName = existing.getStoredName();
        String oldFamily = existing.getFamily();

        ResourceStorageService.StoredFileInfo uploaded = null;

        if (file != null && !file.isEmpty()) {
            uploaded = storage.store(file, family != null ? family : existing.getFamily());
        }

        existing.setTitle(title);
        existing.setDescription(description);

        if (family != null && !family.isBlank()) {
            existing.setFamily(family);
        }

        if (uploaded != null) {
            existing.setStoredName(uploaded.storedName);
            existing.setOriginalName(uploaded.originalName);
            existing.setContentType(uploaded.contentType);
            existing.setSize(uploaded.size);
        }

        resourceRepo.save(existing);

        if (uploaded != null && oldStoredName != null && !oldStoredName.isBlank()) {
            storage.deletePhysical(oldFamily, oldStoredName);
        }

        return ResponseEntity.ok(existing);
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
