package com.shmamsa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserFamilyAssignmentView {
    private Long familyId;
    private String familyName;
    private Integer roleCode;
    private String role;
    private Integer assignmentOrder;
}
