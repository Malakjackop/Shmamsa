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

    // 1️⃣ Full Name
    @JsonProperty("fullName")
    @NotBlank(message = "Full name is required")
    private String fullName;

    // 2️⃣ Username
    @NotBlank(message = "Username is required")
    @Column(nullable = false, unique = true, length = 50)
    private String username;

    // 3️⃣ Password
    @NotBlank(message = "Password is required")
    @Column(nullable = false)
    private String password;

    // 4️⃣ National ID
    @NotBlank(message = "National ID is required")
    @Size(min = 14, max = 14, message = "National ID must be exactly 14 digits")
    @Pattern(regexp = "\\d{14}", message = "National ID must contain only numbers")
    @Column(length = 20, unique = true)
    private String nationalId;

    // 5️⃣ Phone Number
    @Pattern(regexp = "^$|\\d{11}", message = "Phone number must be 11 digits or empty")
    @Column(length = 15)
    private String phoneNumber;

    // 6️⃣ Guardian’s Phone
    @Pattern(regexp = "^$|\\d{11}", message = "Guardian phone must be 11 digits or empty")
    @Column(length = 15)
    private String guardiansPhone;


    // 7️⃣ Guardian Relation (mom or dad)
    @Column(length = 20)
    private String guardianRelation;

    // 8️⃣ Date of Birth
    private LocalDate dateOfBirth;

    // 9️⃣ Status (student / graduate)
    @Column(length = 20)
    private String status;

    // 🔟 Study Type (school / university)
    @Column(length = 20)
    private String studyType;

    // 11️⃣ School Info (only if studyType = school)
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

    @Column(length = 50)
    private String deaconDegree; // ✅ new field


    @NotBlank(message = "Email is required")
    @Column(nullable = false, unique = true, length = 120)
    private String email;

    // 16️⃣ Role
    private String role = "USER";
}
