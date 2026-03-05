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

    @NotBlank(message = "Deacon family is required")
    @Column(length = 100)
    private String deaconFamily;

    @Column(length = 100)
    private String deaconFamily2;

    @Column(length = 100)
    private String deaconFamily3;

    @Column(length = 100)
    private String deaconFamily4;

    @Column(length = 30)
    private String deaconFamilyRole;

    @Column(length = 30)
    private String deaconFamilyRole2;

    @Column(length = 30)
    private String deaconFamilyRole3;

    @Column(length = 30)
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

    public String roleForFamilyBase(String familyBase) {
        if (familyBase == null || familyBase.isBlank()) return null;
        String base = familyBase.trim();

        String f1 = com.shmamsa.util.FamilyUtil.mainFamily(getDeaconFamily());
        String f2 = com.shmamsa.util.FamilyUtil.mainFamily(getDeaconFamily2());
        String f3 = com.shmamsa.util.FamilyUtil.mainFamily(getDeaconFamily3());
        String f4 = com.shmamsa.util.FamilyUtil.mainFamily(getDeaconFamily4());

        if (f1 != null && f1.equalsIgnoreCase(base)) {
            return (getDeaconFamilyRole() != null && !getDeaconFamilyRole().isBlank())
                    ? getDeaconFamilyRole().trim().toUpperCase()
                    : String.valueOf(getRole()).trim().toUpperCase();
        }
        if (f2 != null && f2.equalsIgnoreCase(base)) return getDeaconFamilyRole2() == null ? null : getDeaconFamilyRole2().trim().toUpperCase();
        if (f3 != null && f3.equalsIgnoreCase(base)) return getDeaconFamilyRole3() == null ? null : getDeaconFamilyRole3().trim().toUpperCase();
        if (f4 != null && f4.equalsIgnoreCase(base)) return getDeaconFamilyRole4() == null ? null : getDeaconFamilyRole4().trim().toUpperCase();
        return null;
    }
}
