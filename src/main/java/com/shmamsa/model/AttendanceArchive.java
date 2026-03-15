package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDateTime;

@Entity
@Getter
@Setter
@Table(name = "attendance_archives")
public class AttendanceArchive {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    // اسم الأرشيف الذي يكتبه المستخدم (مثلاً: 2025-2026)
    @Column(nullable = false, length = 120)
    private String name;

    // مين عمل الأرشيف
    @Column(length = 120)
    private String createdByUsername;

    @Column(length = 255)
    private String createdByFullName;

    private LocalDateTime createdAt;

    private Integer totalUsers;
    private Integer totalRecords;

    // Snapshot لبيانات المستخدمين وقت الأرشفة (JSON)
    @Lob
    @Column(columnDefinition = "TEXT")
    private String usersJson;

    // Snapshot لسجل الحضور وقت الأرشفة (JSON)
    @Lob
    @Column(columnDefinition = "TEXT")
    private String recordsJson;

    // Snapshot لدرجات المستخدمين وقت الأرشفة (JSON)
    @Lob
    @Column(columnDefinition = "TEXT")
    private String gradesJson;

    @PrePersist
    public void onCreate() {
        if (createdAt == null) createdAt = LocalDateTime.now();
    }
}
