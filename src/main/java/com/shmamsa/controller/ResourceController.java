package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.ResourceFile;
import com.shmamsa.model.User;
import com.shmamsa.repository.ResourceFileRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.ResourceStorageService;
import com.shmamsa.util.FamilyUtil;
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
    private final ResourceStorageService storage;

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me =userRepo.findByUsername(auth.getName()).orElse(null);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        String target = (family != null && !family.isBlank()) ? family : me.getDeaconFamily();

        if ("ALL".equalsIgnoreCase(target.trim())) {
            return ResponseEntity.ok(
                    resourceRepo.findAll()
                            .stream()
                            .sorted((a, b) -> b.getCreatedAt().compareTo(a.getCreatedAt()))
                            .toList()
            );
        }

        List<String> families = FamilyUtil.variantsPlusAll(target);
        return ResponseEntity.ok(resourceRepo.findByFamilyInOrderByCreatedAtDesc(families));
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

        String targetFamily = (family == null || family.isBlank()) ? me.getDeaconFamily() : family;

        if (!"ALL".equalsIgnoreCase(targetFamily.trim())) {
            targetFamily = FamilyUtil.mainFamily(targetFamily);
        } else {
            targetFamily = "ALL";
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
            if ("ALL".equalsIgnoreCase(family.trim())) existing.setFamily("ALL");
            else existing.setFamily(FamilyUtil.mainFamily(family));
        }

        if (file != null && !file.isEmpty()) {
            storage.deletePhysical(existing.getFamily(), existing.getStoredName());

            String fam = existing.getFamily() == null ? "ALL" : existing.getFamily();
            var stored = storage.store(file, fam);

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

        storage.deletePhysical(existing.getFamily(), existing.getStoredName());

        resourceRepo.delete(existing);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/{id}/download")
    public ResponseEntity<?> download(@PathVariable Long id) throws Exception {

        ResourceFile existing = resourceRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "File not found"));

        var path = storage.resolvePath(existing.getFamily(), existing.getStoredName());
        if (!Files.exists(path)) throw new ApiException(HttpStatus.NOT_FOUND, "Stored file missing");

        var bytes = Files.readAllBytes(path);

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + existing.getOriginalName() + "\"")
                .contentType(MediaType.parseMediaType(existing.getContentType() == null ? "application/octet-stream" : existing.getContentType()))
                .body(bytes);
    }
}
