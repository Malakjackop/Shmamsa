package com.shmamsa.dto;
import com.shmamsa.validation.customAnnotation.DifferentParentPhones;
import com.shmamsa.validation.customAnnotation.DifferentParentPhonesValidator.HasParentPhones;
import com.shmamsa.validation.customAnnotation.ValidNationalId;
import jakarta.validation.constraints.NotBlank;
import lombok.Data;
import jakarta.validation.constraints.Pattern;

import java.util.Map;

@Data
@DifferentParentPhones(message = "رقم ولي الأمر يجب أن يكون مختلفًا عن الرقم الشخصي")
public class RegisterRequest implements HasParentPhones {

    @NotBlank(message = "Full name is required")
    private String fullName;

    @NotBlank(message = "Username is required")
    private String username;


    @NotBlank(message = "Password is required")
    private String password;

    @NotBlank(message = "Confirm password is required")
    private String confirmPassword;

    @NotBlank(message = "National ID is required")
    @ValidNationalId(minAge = 6, message = "National ID is invalid or age is أقل من 6 سنوات")
    private String nationalId;

    private String dateOfBirth;
    private String gender;

    @NotBlank(message = "Deacon family is required")
    private String deaconFamily;

    private Long deaconFamilyId;

    @NotBlank(message = "Deacon degree is required")
    private String deaconDegree;

    private String khors;

    private Integer ordainYear;

    private String yearsInFamily;

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

    /** Dynamic custom fields: key → value */
    private Map<String, String> customFields;
}
