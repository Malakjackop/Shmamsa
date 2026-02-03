
package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Entity
@Table(
        name = "attendance_records",
        uniqueConstraints = @UniqueConstraint(columnNames = {"user_id", "att_date", "att_type"})
)
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AttendanceRecord {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(optional = false)
    @JoinColumn(name = "user_id")
    private User user;

    @Column(name = "att_date", nullable = false)
    private LocalDate date;

    @Enumerated(EnumType.STRING)
    @Column(name = "att_type", nullable = false, length = 30)
    private AttendanceType type;

    @Column(nullable = false)
    private LocalDateTime createdAt;
}
