package com.shmamsa.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.shmamsa.validation.customAnnotation.DifferentParentPhones;
import jakarta.persistence.*;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Pattern;
import jakarta.validation.constraints.Size;
import lombok.*;

import java.time.LocalDate;

@Entity
@Table(name = "users")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
@DifferentParentPhones
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

    // 12️⃣ University Info (only if studyType = university)
    @Column(length = 100)
    private String universityName;

    @Column(length = 100)
    private String faculty;

    @Column(length = 20)
    private String universityGrade;

    // 13️⃣ Graduate Info
    @Column(length = 100)
    private String graduatedFrom;

    @Column(length = 100)
    private String graduateJob;

    // 14️⃣ Work info (for students)
    private Boolean isWorking;

    @Column(length = 100)
    private String workDetails;

    // 15️⃣ Deacon Family (new field)
    @NotBlank(message = "Deacon family is required")
    @Column(length = 100)
    private String deaconFamily;

    // ✅ NEW: Optional second serving family (to allow serving 2 families)
    @Column(length = 100)
    private String deaconFamily2;

    // ✅ Optional third & fourth serving families (future-proof)
    @Column(length = 100)
    private String deaconFamily3;

    @Column(length = 100)
    private String deaconFamily4;

    @Column(length = 50)
    private String deaconDegree; // ✅ new field

    // Khors (Choir): MARMARKOS / ATHANASIUS / BOTH / NONE
    @Column(length = 30)
    private String khors;

    // Servant serving scope: FAMILY_ONLY / KHORS_ONLY / BOTH
    @Column(length = 20)
    private String servingScope;

    // ✅ NEW: which khors servant attends
    @Column(length = 30)
    private String attendKhors; // MARMARKOS / ATHANASIUS / NONE

    @NotBlank(message = "Email is required")
    @Column(nullable = false, unique = true, length = 120)
    private String email;

    // 16️⃣ Role
    private String role = "MAKHDOM";
}
