package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
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
    private LocalDate eventAt;

    @Column(nullable = false, length = 120)
    private String targetFamily;

    @Column(length = 30)
    private String targetAudience;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EventStatus status;

    private LocalDate publishAt;

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