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

    // "ALL" OR family variants
    @NotBlank
    private String targetFamily;

    // optional
    private LocalDateTime publishAt;
}