package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "grade_sheets", uniqueConstraints = {
        @UniqueConstraint(columnNames = {"family_base"}),
        @UniqueConstraint(columnNames = {"family_id"})
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

    @Column(name = "family_id", nullable = false, unique = true)
    private Long familyId;

    @Lob
    @Column(name="data_json", columnDefinition = "TEXT")
    private String dataJson; // legacy first-term compatibility

    @Lob
    @Column(name="first_term_data_json", columnDefinition = "TEXT")
    private String firstTermDataJson;

    @Lob
    @Column(name="second_term_data_json", columnDefinition = "TEXT")
    private String secondTermDataJson;

    @Column(length = 20)
    private String status; // DRAFT / PUBLISHED

    private LocalDateTime updatedAt;
    private LocalDateTime publishedAt; // latest published term

    @Column(name = "first_published_at")
    private LocalDateTime firstPublishedAt;

    @Column(name = "second_published_at")
    private LocalDateTime secondPublishedAt;

    @Column(name = "result_term", length = 10)
    private String resultTerm; // latest published term

    private Long publishedByUserId; // latest publisher

    @Column(name = "first_published_by_user_id")
    private Long firstPublishedByUserId;

    @Column(name = "second_published_by_user_id")
    private Long secondPublishedByUserId;
}
