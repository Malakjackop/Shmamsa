package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "grade_sheets", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"family_base"})
})
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class GradeSheet {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name="family_base", nullable = false, length = 120)
    private String familyBase;

    @Lob
    @Column(name="data_json", columnDefinition = "TEXT")
    private String dataJson;

    @Column(length = 20)
    private String status; // DRAFT / PUBLISHED

    private LocalDateTime updatedAt;
    private LocalDateTime publishedAt;

    private Long publishedByUserId;
}
