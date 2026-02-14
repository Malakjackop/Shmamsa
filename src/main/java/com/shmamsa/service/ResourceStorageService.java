package com.shmamsa.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.*;
import java.util.UUID;

@Service
public class ResourceStorageService {

    @Value("${app.upload.dir:uploads}")
    private String uploadDir;

    public static class StoredFileInfo {
        public final String storedName;
        public final String originalName;
        public final String contentType;
        public final long size;
        public final Path fullPath;

        public StoredFileInfo(String storedName, String originalName, String contentType, long size, Path fullPath) {
            this.storedName = storedName;
            this.originalName = originalName;
            this.contentType = contentType;
            this.size = size;
            this.fullPath = fullPath;
        }
    }

    public StoredFileInfo store(MultipartFile file, String family) throws IOException {
        if (file == null || file.isEmpty()) throw new IOException("Empty file");

        String safeFamily = (family == null || family.isBlank()) ? "ALL" : family.trim();
        String original = StringUtils.cleanPath(file.getOriginalFilename() == null ? "file" : file.getOriginalFilename());

        // امتداد
        String ext = "";
        int dot = original.lastIndexOf('.');
        if (dot >= 0) ext = original.substring(dot);

        String stored = UUID.randomUUID() + ext;

        Path base = Paths.get(uploadDir, "resources", safeFamily);
        Files.createDirectories(base);

        Path target = base.resolve(stored);
        Files.copy(file.getInputStream(), target, StandardCopyOption.REPLACE_EXISTING);

        return new StoredFileInfo(stored, original, file.getContentType(), file.getSize(), target);
    }

    public Path resolvePath(String family, String storedName) {
        String safeFamily = (family == null || family.isBlank()) ? "ALL" : family.trim();
        return Paths.get(uploadDir, "resources", safeFamily, storedName);
    }

    public void deletePhysical(String family, String storedName) {
        try {
            Path p = resolvePath(family, storedName);
            Files.deleteIfExists(p);
        } catch (Exception ignored) {}
    }
}
