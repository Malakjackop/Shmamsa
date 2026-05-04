package com.shmamsa.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.persistence.*;
import lombok.*;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;

@Entity
@Table(name = "custom_registration_fields")
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class CustomRegistrationField {

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Unique key used in forms and storage (e.g. "fatherOfConfession") */
    @Column(name = "field_key", nullable = false, unique = true, length = 100)
    private String fieldKey;

    /** Arabic label shown in UI */
    @Column(name = "label_ar", nullable = false, length = 200)
    private String labelAr;

    /** Field type: TEXT or SELECT */
    @Column(name = "field_type", nullable = false, length = 20)
    private String fieldType;

    /** Comma-separated options (only for SELECT type) */
    @Column(name = "options", length = 1000)
    private String options;

    /** Whether this field is required during registration */
    @Column(nullable = false)
    @Builder.Default
    private Boolean required = false;

    /**
     * Comma-separated conditional requirement rules:
     * NEVER, MEMBER_ONLY, SERVANT_ONLY,
     * STUDENT_ONLY, STUDENT_SCHOOL, STUDENT_UNIVERSITY,
     * GRADUATE_ONLY
     */
    @Column(name = "required_rule", length = 255)
    @Builder.Default
    private String requiredRule = "NEVER";

    /**
     * Visibility rule:
     * ALWAYS, MEMBER_ONLY, SERVANT_ONLY,
     * STUDENT_ONLY, STUDENT_SCHOOL, STUDENT_UNIVERSITY,
     * GRADUATE_ONLY
     */
    @Column(name = "visibility_rule", nullable = false, length = 30)
    @Builder.Default
    private String visibilityRule = "ALWAYS";

    /** Optional field key that controls whether this field should be visible */
    @Column(name = "visibility_depends_on", length = 100)
    private String visibilityDependsOn;

    /** Comma-separated values of the controlling field that make this field visible */
    @Column(name = "visibility_depends_values", length = 1000)
    private String visibilityDependsValues;

    /** JSON-serialized visibility conditions list */
    @JsonIgnore
    @Column(name = "visibility_conditions", length = 4000)
    private String visibilityConditionsJson;

    /**
     * Where to display the value after registration:
     * FAMILY_INFO, PROFILE, NONE
     */
    @Column(name = "show_in", nullable = false, length = 20)
    @Builder.Default
    private String showIn = "NONE";

    @Column(name = "show_in_configured")
    @Builder.Default
    private Boolean showInConfigured = false;

    @Column(name = "profile_editable")
    @Builder.Default
    private Boolean profileEditable = false;

    /** Display order in the registration form */
    @Column(name = "display_order")
    @Builder.Default
    private Integer displayOrder = 0;

    /** Whether this field is currently active */
    @Column(nullable = false)
    @Builder.Default
    private Boolean enabled = true;

    /** Whether this field is a core system field (cannot be deleted or have key changed) */
    @Column(name = "is_system", nullable = false)
    @Builder.Default
    private Boolean isSystem = false;

    @Column(name = "created_at")
    @Builder.Default
    private LocalDateTime createdAt = LocalDateTime.now();

    @Transient
    @JsonProperty("visibilityConditions")
    public List<VisibilityConditionConfig> getVisibilityConditions() {
        List<VisibilityConditionConfig> parsed = parseVisibilityConditionsJson(visibilityConditionsJson);
        if (!parsed.isEmpty()) {
            return parsed;
        }
        return buildLegacyVisibilityConditions();
    }

    @JsonProperty("visibilityConditions")
    public void setVisibilityConditions(List<VisibilityConditionConfig> visibilityConditions) {
        this.visibilityConditionsJson = writeVisibilityConditionsJson(visibilityConditions);
    }

    @JsonProperty("showInConfigured")
    public Boolean getShowInConfigured() {
        return Boolean.TRUE.equals(showInConfigured);
    }

    @JsonProperty("showInConfigured")
    public void setShowInConfigured(Boolean showInConfigured) {
        this.showInConfigured = Boolean.TRUE.equals(showInConfigured);
    }

    @JsonProperty("profileEditable")
    public Boolean getProfileEditable() {
        return Boolean.TRUE.equals(profileEditable);
    }

    @JsonProperty("profileEditable")
    public void setProfileEditable(Boolean profileEditable) {
        this.profileEditable = Boolean.TRUE.equals(profileEditable);
    }

    @PrePersist
    @PreUpdate
    private void normalizeDefaults() {
        if (showInConfigured == null) {
            showInConfigured = false;
        }
        if (profileEditable == null) {
            profileEditable = false;
        }
    }

    public static List<VisibilityConditionConfig> parseVisibilityConditionsJson(String rawJson) {
        if (rawJson == null || rawJson.isBlank()) {
            return List.of();
        }

        try {
            List<VisibilityConditionConfig> parsed = OBJECT_MAPPER.readValue(
                    rawJson,
                    new TypeReference<List<VisibilityConditionConfig>>() {}
            );

            if (parsed == null || parsed.isEmpty()) {
                return List.of();
            }

            List<VisibilityConditionConfig> normalized = new ArrayList<>();
            for (VisibilityConditionConfig condition : parsed) {
                VisibilityConditionConfig safe = normalizeCondition(condition);
                if (safe != null) {
                    normalized.add(safe);
                }
            }
            return normalized;
        } catch (Exception ex) {
            return List.of();
        }
    }

    public static String writeVisibilityConditionsJson(List<VisibilityConditionConfig> visibilityConditions) {
        if (visibilityConditions == null || visibilityConditions.isEmpty()) {
            return null;
        }

        List<VisibilityConditionConfig> normalized = new ArrayList<>();
        for (VisibilityConditionConfig condition : visibilityConditions) {
            VisibilityConditionConfig safe = normalizeCondition(condition);
            if (safe != null) {
                normalized.add(safe);
            }
        }

        if (normalized.isEmpty()) {
            return null;
        }

        try {
            return OBJECT_MAPPER.writeValueAsString(normalized);
        } catch (Exception ex) {
            return null;
        }
    }

    private List<VisibilityConditionConfig> buildLegacyVisibilityConditions() {
        List<VisibilityConditionConfig> legacyConditions = new ArrayList<>();

        String legacyRule = normalizeRuleToken(this.visibilityRule);
        if (!legacyRule.isBlank() && !"ALWAYS".equals(legacyRule)) {
            legacyConditions.add(
                    VisibilityConditionConfig.builder()
                            .type("RULE")
                            .rule(legacyRule)
                            .build()
            );
        }

        String dependsOn = safe(this.visibilityDependsOn);
        List<String> values = splitValues(this.visibilityDependsValues);
        if (!dependsOn.isBlank() && !values.isEmpty()) {
            legacyConditions.add(
                    VisibilityConditionConfig.builder()
                            .type("FIELD")
                            .fieldKey(dependsOn)
                            .values(values)
                            .build()
            );
        }

        return legacyConditions;
    }

    private static VisibilityConditionConfig normalizeCondition(VisibilityConditionConfig condition) {
        if (condition == null) {
            return null;
        }

        String type = safe(condition.getType()).toUpperCase(Locale.ROOT);
        if ("RULE".equals(type)) {
            String rule = normalizeRuleToken(condition.getRule());
            if (rule.isBlank()) {
                return null;
            }

            return VisibilityConditionConfig.builder()
                    .type("RULE")
                    .rule(rule)
                    .values(List.of())
                    .build();
        }

        if ("FIELD".equals(type)) {
            String fieldKey = safe(condition.getFieldKey());
            List<String> values = splitValues(condition.getValues());
            if (fieldKey.isBlank() || values.isEmpty()) {
                return null;
            }

            return VisibilityConditionConfig.builder()
                    .type("FIELD")
                    .fieldKey(fieldKey)
                    .values(values)
                    .build();
        }

        return null;
    }

    private static String normalizeRuleToken(String value) {
        return safe(value).toUpperCase(Locale.ROOT);
    }

    private static String safe(String value) {
        return value == null ? "" : value.trim();
    }

    private static List<String> splitValues(String rawValues) {
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        if (rawValues == null || rawValues.isBlank()) {
            return List.of();
        }

        for (String rawValue : rawValues.split(",")) {
            String current = safe(rawValue);
            if (!current.isBlank()) {
                normalized.add(current);
            }
        }

        return new ArrayList<>(normalized);
    }

    private static List<String> splitValues(List<String> rawValues) {
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        if (rawValues == null || rawValues.isEmpty()) {
            return List.of();
        }

        for (String rawValue : rawValues) {
            String current = safe(rawValue);
            if (!current.isBlank()) {
                normalized.add(current);
            }
        }

        return new ArrayList<>(normalized);
    }
}
