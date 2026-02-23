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
@Table(name = "attendance_records")
public class AttendanceRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    private User user;

    private LocalDate date;
    private LocalTime time;

    @Enumerated(EnumType.STRING)
    private AttendanceType type;

    // PRESENT = حضر, ABSENT = غياب
    @Enumerated(EnumType.STRING)
    @Column
    private AttendanceStatus status = AttendanceStatus.PRESENT;

    @ManyToOne
    @JoinColumn(name = "taken_by_user_id")
    private User takenBy;

    private LocalDateTime createdAt;

    @PrePersist
    public void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
