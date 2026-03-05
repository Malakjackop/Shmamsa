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
// ✅ For FAMILY_MEETING (and any future family-scoped types), we store which family this record belongs to
// so that a user serving in multiple families has separate attendance per family.
@Column(length = 120)
private String familyBase;



    @ManyToOne
    @JoinColumn(name = "taken_by_user_id")
    private User takenBy;

    // ✅ لما نعمل Start New Year هنأرشف السجل بدل ما نمسحه
    private boolean archived = false;

    @ManyToOne
    @JoinColumn(name = "archive_id")
    private AttendanceArchive archive;

    private LocalDateTime createdAt;

    @PrePersist
    public void onCreate() {
        createdAt = LocalDateTime.now();
    }
}
