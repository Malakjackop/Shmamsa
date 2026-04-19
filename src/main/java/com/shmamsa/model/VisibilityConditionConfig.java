package com.shmamsa.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class VisibilityConditionConfig {

    private String type;
    private String rule;
    private String fieldKey;

    @Builder.Default
    private List<String> values = new ArrayList<>();
}
