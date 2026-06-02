package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

@Entity
@Getter
@Setter
@Table(name = "attendance_schedules",
       uniqueConstraints = @UniqueConstraint(columnNames = {"family_base", "type", "day_of_week"}))
public class AttendanceSchedule {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "family_base", nullable = false, length = 120)
    private String familyBase;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AttendanceType type;

    @Column(name = "day_of_week", nullable = false)
    private Integer dayOfWeek;

    @Column
    private LocalTime time;

    @Column(nullable = false)
    private boolean enabled = true;

    @ManyToOne
    @JoinColumn(name = "created_by_user_id")
    private User createdBy;

    private LocalDateTime createdAt;

    @PrePersist
    public void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
