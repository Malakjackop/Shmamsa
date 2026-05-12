package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "events")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class Event {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 200)
    private String title;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(nullable = false)
    private LocalDateTime eventAt;

    @Column(nullable = false, length = 120)
    private String targetFamily;

    @Column(name = "target_family_id")
    private Long targetFamilyId;

    @Column(length = 30)
    private String targetAudience;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EventStatus status;

    private LocalDateTime removeAt;

    private Integer reminderBeforeMinutes;

    @Column(length = 500)
    private String imageStoredName;

    @Column(length = 255)
    private String imageOriginalName;

    @Column(length = 120)
    private String imageContentType;

    private Long imageSize;

    @Column(columnDefinition = "TEXT")
    private String cancelMessage;

    private LocalDateTime cancelNoticeUntil;

    private LocalDateTime cancelledAt;

    private LocalDateTime publishedAt;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "created_by_id")
    private User createdBy;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    @PrePersist
    public void prePersist() {
        LocalDateTime now = LocalDateTime.now();
        if (status == null) status = EventStatus.PENDING;
        if (targetAudience == null || targetAudience.isBlank()) targetAudience = "EVERYONE";
        createdAt = now;
        updatedAt = now;
    }

    @PreUpdate
    public void preUpdate() {
        if (targetAudience == null || targetAudience.isBlank()) targetAudience = "EVERYONE";
        updatedAt = LocalDateTime.now();
    }
}
