package com.shmamsa.dto;

import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
public class ProfileUpdateRequest {
    private String fullName;
    private String phoneNumber;
    private String guardiansPhone;
    private String guardianRelation;
    private String deaconFamily;
    private String deaconDegree;
    private String status;
    private String studyType;
    private String schoolName;
    private String universityName;
    private String faculty;
    private String universityGrade;
    private String workDetails;
}
