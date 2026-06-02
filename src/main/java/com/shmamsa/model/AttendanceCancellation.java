package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Getter
@Setter
@Table(name = "attendance_cancellations",
       uniqueConstraints = @UniqueConstraint(columnNames = {"cancelled_date", "type", "family_base"}))
public class AttendanceCancellation {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "cancelled_date", nullable = false)
    private LocalDate date;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private AttendanceType type;

    @Column(name = "family_base", nullable = false, length = 120)
    private String familyBase;

    @ManyToOne
    @JoinColumn(name = "cancelled_by_user_id")
    private User cancelledBy;

    private LocalDateTime createdAt;

    @PrePersist
    public void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
