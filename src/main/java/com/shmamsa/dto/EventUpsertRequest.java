package com.shmamsa.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import lombok.*;

import java.time.LocalDate;

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
    private LocalDate eventAt;

    @NotBlank
    private String targetFamily;

    private String targetAudience;

    private LocalDate publishAt;
}