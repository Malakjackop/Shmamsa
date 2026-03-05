package com.shmamsa.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IftekadVisitUpdateRequest {
    /** ISO date: yyyy-MM-dd */
    private String date;
    private String description;
    private String companions;
}