package com.shmamsa.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;

import java.time.LocalDateTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class EventUpsertRequest {

    @NotBlank
    private String title;

    private String description;

    @NotNull
    private LocalDateTime eventAt;

    @NotBlank
    private String targetFamily;

    private Long targetFamilyId;

    private String targetAudience;

    private LocalDateTime removeAt;

    private Integer reminderBeforeMinutes;
}

