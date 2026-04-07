package com.shmamsa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class User {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @JsonProperty("fullName")
    @NotBlank(message = "Full name is required")
    private String fullName;

    @NotBlank(message = "Username is required")
    @Column(nullable = false, unique = true, length = 50)
    private String username;

    @NotBlank(message = "Password is required")
    @Column(nullable = false)
    private String password;

    @NotBlank(message = "National ID is required")
    @Size(min = 14, max = 14, message = "National ID must be exactly 14 digits")
    @Pattern(regexp = "\\d{14}", message = "National ID must contain only numbers")
    @Column(length = 20, unique = true)
    private String nationalId;

    @Pattern(regexp = "^$|\\d{11}", message = "Phone number must be 11 digits or empty")
    @Column(length = 15)
    private String phoneNumber;

    @Column(length = 255)
    private String address;

    @Pattern(regexp = "^$|\\d{11}", message = "Guardian phone must be 11 digits or empty")
    @Column(length = 15)
    private String guardiansPhone;


    @Column(length = 20)
    private String guardianRelation;

    private LocalDate dateOfBirth;

    @Column(length = 10)
    private String gender;

    @Column(length = 20)
    private String status;

    @Column(length = 20)
    private String studyType;

    @Column(length = 100)
    private String schoolName;

    @Column(length = 20)
    private String schoolGrade;

    @Column(length = 100)
    private String universityName;

    @Column(length = 100)
    private String faculty;

    @Column(length = 20)
    private String universityGrade;

    @Column(length = 100)
    private String graduatedFrom;

    @Column(length = 100)
    private String graduateJob;

    private Boolean isWorking;

    @Column(length = 100)
    private String workDetails;

    @Transient
    private String deaconFamily;

    @Transient
    private Long deaconFamilyId;

    @Transient
    private String deaconFamily2;

    @Transient
    private Long deaconFamily2Id;

    @Transient
    private String deaconFamily3;

    @Transient
    private Long deaconFamily3Id;

    @Transient
    private String deaconFamily4;

    @Transient
    private Long deaconFamily4Id;

    @Transient
    private String deaconFamilyRole;

    @Transient
    private String deaconFamilyRole2;

    @Transient
    private String deaconFamilyRole3;

    @Transient
    private String deaconFamilyRole4;

    @Column(length = 50)
    private String deaconDegree;

    @Column(length = 30)
    private String khors;

    @Column(name = "khors_year")
    private Integer khorsYear;


    @Column(length = 20)
    private String servingScope;

    @Column(length = 30)
    private String attendKhors;

    @NotBlank(message = "Email is required")
    @Column(nullable = false, unique = true, length = 120)
    private String email;

    private String role = "MAKHDOM";

    // --- Grades publish confirmation (used by /api/grades to show success/fail choice once per publish) ---
    @Column(name = "last_school_result_family_base", length = 100)
    private String lastSchoolResultFamilyBase;

    @Column(name = "last_school_result_published_at")
    private LocalDateTime lastSchoolResultPublishedAt;

    @Column(name = "last_school_result_status", length = 10)
    private String lastSchoolResultStatus; // PASS / FAIL

    @Transient
    @Builder.Default
    private List<UserFamilyAssignmentView> familyAssignments = new ArrayList<>();
}
