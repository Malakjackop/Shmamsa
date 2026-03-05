package com.shmamsa.dto;

import lombok.*;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class IftekadVisitCreateRequest {
    private Long memberId;
    /** ISO date: yyyy-MM-dd */
    private String date;
    private String description;
    private String companions;
}