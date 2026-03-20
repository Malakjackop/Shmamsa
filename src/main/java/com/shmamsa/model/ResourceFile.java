package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "resource_files")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ResourceFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(length = 200)
    private String title;

    @Column(length = 500)
    private String description;

    @Column(length = 255)
    private String originalName;

    @Column(length = 255, nullable = false)
    private String storedName;

    @Column(length = 120)
    private String contentType;

    private Long size;

    @Column(length = 120)
    private String family;

    @Column(name = "family_id")
    private Long familyId;

    @Column(length = 40)
    private String category;

    @Column(length = 50)
    private String uploadedByUsername;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
    }

    @PreUpdate
    public void onUpdate() {
        updatedAt = LocalDateTime.now();
    }
}
