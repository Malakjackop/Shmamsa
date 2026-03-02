package com.shmamsa.dto;
import com.shmamsa.validation.customAnnotation.ValidNationalId;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import jakarta.validation.constraints.Pattern;

@Data
public class RegisterRequest {

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

    @ValidNationalId(minAge = 6, message = "Servant must be at least 6 years old")
    private String nationalId;

    private String dateOfBirth;
    private String gender;

    @NotBlank(message = "Deacon family is required")
    private String deaconFamily;

    @NotBlank(message = "Deacon degree is required")
    private String deaconDegree;

    private String khors;

    @Pattern(regexp = "^$|^\\d{11}$", message = "رقم الهاتف يجب أن يكون 11 رقم")
    private String phoneNumber;

    private String address;
    @Pattern(regexp = "^$|^\\d{11}$", message = "رقم ولي الأمر يجب أن يكون 11 رقم")
    private String guardiansPhone;
    private String guardianRelation;

    private String status;
    private String studyType;

    private String schoolName;
    private String schoolGrade;

    private String universityName;
    private String faculty;
    private String universityGrade;

    private Boolean isWorking;
    private String workDetails;

    private String graduatedFrom;
    private String graduateJob;

}
