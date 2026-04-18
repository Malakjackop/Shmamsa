package com.shmamsa.model;

import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;

@Entity
@Table(name = "custom_registration_fields")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomRegistrationField {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Unique key used in forms and storage (e.g. "fatherOfConfession") */
    @Column(name = "field_key", nullable = false, unique = true, length = 100)
    private String fieldKey;

    /** Arabic label shown in UI */
    @Column(name = "label_ar", nullable = false, length = 200)
    private String labelAr;

    /** Field type: TEXT or SELECT */
    @Column(name = "field_type", nullable = false, length = 20)
    private String fieldType;

    /** Comma-separated options (only for SELECT type) */
    @Column(name = "options", length = 1000)
    private String options;

    /** Whether this field is required during registration */
    @Column(nullable = false)
    @Builder.Default
    private Boolean required = false;

    /**
     * Comma-separated conditional requirement rules:
     * NEVER, MEMBER_ONLY, SERVANT_ONLY,
     * STUDENT_ONLY, STUDENT_SCHOOL, STUDENT_UNIVERSITY,
     * GRADUATE_ONLY
     */
    @Column(name = "required_rule", length = 30)
    @Builder.Default
    private String requiredRule = "NEVER";

    /**
     * Visibility rule:
     * ALWAYS, MEMBER_ONLY, SERVANT_ONLY,
     * STUDENT_ONLY, STUDENT_SCHOOL, STUDENT_UNIVERSITY,
     * GRADUATE_ONLY
     */
    @Column(name = "visibility_rule", nullable = false, length = 30)
    @Builder.Default
    private String visibilityRule = "ALWAYS";

    /**
     * Where to display the value after registration:
     * FAMILY_INFO, PROFILE, NONE
     */
    @Column(name = "show_in", nullable = false, length = 20)
    @Builder.Default
    private String showIn = "NONE";

    /** Display order in the registration form */
    @Column(name = "display_order")
    @Builder.Default
    private Integer displayOrder = 0;

    /** Whether this field is currently active */
    @Column(nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /** Whether this field is a core system field (cannot be deleted or have key changed) */
    @Column(name = "is_system", nullable = false)
    @Builder.Default
    private Boolean isSystem = false;

    @Column(name = "created_at")
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();
}
