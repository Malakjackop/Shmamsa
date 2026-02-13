package com.shmamsa.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProfileUpdateRequest {
    private String email;
    private String fullName;
    private String phoneNumber;
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
}
