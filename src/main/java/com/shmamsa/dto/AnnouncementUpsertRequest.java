package com.shmamsa.dto;

import jakarta.validation.constraints.NotBlank;
import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class AnnouncementUpsertRequest {

    @NotBlank
    private String title;

    private String description;

    @NotBlank
    private String targetFamily;

    private Long targetFamilyId;

    private String targetAudience;
}
