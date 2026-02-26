package com.shmamsa.dto;

import lombok.Builder;
import lombok.Data;


@Data
@Builder
public class KhorsJoinRequestView {
    private Long requestId;
    private Long userId;
    private String fullName;
    private String deaconFamily;
    private String role;
    private String requestedKhors;
    /**
     * Keep this as String to avoid Jackson LocalDateTime serialization issues
     * in some setups.
     */
    private String createdAt;
}
