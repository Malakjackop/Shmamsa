package com.shmamsa.dto;

import com.shmamsa.validation.customAnnotation.ValidNationalId;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;

@Data
public class RegisterServantRequest {

    @NotBlank(message = "Full name is required")
    private String fullName;

    @NotBlank(message = "Username is required")
    private String username;

    @Email(message = "Email should be valid")
    @NotBlank(message = "Email is required")
    private String email;

    @NotBlank(message = "Password is required")
    private String password;

    @NotBlank(message = "Confirm password is required")
    private String confirmPassword;

    @ValidNationalId(minAge = 16, message = "Servant must be at least 16 years old")
    private String nationalId;

    private String dateOfBirth;
    private String gender;

    @NotBlank(message = "Deacon family is required")
    private String deaconFamily;

    @NotBlank(message = "Deacon degree is required")
    private String deaconDegree;

    private String phoneNumber;

    private String address;
    private String guardiansPhone;
    private String guardianRelation;

    @NotBlank(message = "Secret is required")
    private String secret;

    private String status;
    private String studyType;

    private String universityName;
    private String faculty;
    private String universityGrade;

    private String graduatedFrom;
    private String graduateJob;

    private Boolean isWorking;
    private String workDetails;
}
