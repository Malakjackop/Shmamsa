package com.shmamsa.service;

import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;
import software.amazon.awssdk.core.ResponseInputStream;
import software.amazon.awssdk.core.sync.RequestBody;
import software.amazon.awssdk.services.s3.S3Client;
import software.amazon.awssdk.services.s3.model.DeleteObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectRequest;
import software.amazon.awssdk.services.s3.model.GetObjectResponse;
import software.amazon.awssdk.services.s3.model.PutObjectRequest;

import java.io.IOException;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ResourceStorageService {

    private final S3Client s3Client;

    @Value("${cloudflare.r2.bucket}")
    private String bucket;

    public static class StoredFileInfo {
        public final String storedName;
        public final String originalName;
        public final String contentType;
        public final long size;

        public StoredFileInfo(String storedName, String originalName, String contentType, long size) {
            this.storedName = storedName;
            this.originalName = originalName;
            this.contentType = contentType;
            this.size = size;
        }
    }

    public StoredFileInfo store(MultipartFile file, String family) throws IOException {
        if (file == null || file.isEmpty()) throw new IOException("Empty file");

        String safeFamily = (family == null || family.isBlank()) ? "ALL" : family.trim();
        String original = StringUtils.cleanPath(
                file.getOriginalFilename() == null ? "file" : file.getOriginalFilename()
        );

        String ext = "";
        int dot = original.lastIndexOf('.');
        if (dot >= 0) ext = original.substring(dot);

        String stored = "resources/" + safeFamily + "/" + UUID.randomUUID() + ext;

        PutObjectRequest request = PutObjectRequest.builder()
                .bucket(bucket)
                .key(stored)
                .contentType(file.getContentType() == null ? "application/octet-stream" : file.getContentType())
                .build();

        s3Client.putObject(
                request,
                RequestBody.fromInputStream(file.getInputStream(), file.getSize())
        );

        return new StoredFileInfo(
                stored,
                original,
                file.getContentType() == null ? "application/octet-stream" : file.getContentType(),
                file.getSize()
        );
    }

    public ResponseInputStream<GetObjectResponse> download(String storedName) {
        GetObjectRequest request = GetObjectRequest.builder()
                .bucket(bucket)
                .key(storedName)
                .build();

        return s3Client.getObject(request);
    }

    public void deletePhysical(String family, String storedName) {
        try {
            DeleteObjectRequest request = DeleteObjectRequest.builder()
                    .bucket(bucket)
                    .key(storedName)
                    .build();

            s3Client.deleteObject(request);
        } catch (Exception ignored) {
        }
    }
}