package com.shmamsa.dto;

import lombok.Builder;
import lombok.Data;

@Data
@Builder
public class FamilyJoinRequestView {
    private Long requestId;
    private Long userId;
    private String fullName;
    private String username;
    private String deaconFamily;
    private String role;
    private Long familyId;
    private String familyName;
    private String status;
    private String createdAt;
}
