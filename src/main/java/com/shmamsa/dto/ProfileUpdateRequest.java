package com.shmamsa.dto;

import com.shmamsa.validation.customAnnotation.DifferentParentPhones;
import com.shmamsa.validation.customAnnotation.DifferentParentPhonesValidator.HasParentPhones;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.Pattern;
import lombok.Getter;
import lombok.Setter;

import java.util.Map;

@Getter
@Setter
@DifferentParentPhones(message = "رقم ولي الأمر يجب أن يكون مختلفًا عن الرقم الشخصي")
public class ProfileUpdateRequest implements HasParentPhones {
    @Email(message = "Email should be valid")
    private String email;
    private String fullName;

    @Pattern(regexp = "^$|^\\d{11}$", message = "رقم الهاتف يجب أن يكون 11 رقم")
    private String phoneNumber;

    private String address;

    @Pattern(regexp = "^$|^\\d{11}$", message = "رقم ولي الأمر يجب أن يكون 11 رقم")
    private String guardiansPhone;
    private String guardianRelation;
    private String deaconFamily;
    private String deaconDegree;
    private String status;
    private String studyType;
    private String schoolName;
    private String schoolGrade;
    private String universityName;
    private String faculty;
    private String universityGrade;
    private String graduatedFrom;
    private String graduateJob;
    private String workDetails;
    private Map<String, String> customFields;
}
