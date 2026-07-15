package com.shmamsa.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AppSetting;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.repository.AppSettingRepository;
import lombok.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AttendanceConfigService {

    private static final String ATTENDANCE_CONFIG_KEY = "attendance_config";

    private final AppSettingRepository appSettingRepository;
    private final ObjectMapper objectMapper;

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class CustomEventConfig {
        private String id;
        private String familyBase;
        private String title;
        private Integer dayOfWeek;
        @Builder.Default
        private Boolean enabled = true;
        @Builder.Default
        private Boolean alwaysActive = true;
        private LocalDate activeFrom;
        private LocalDate activeTo;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class AttendanceRuleGroup {
        private String name;
        private List<String> types;
        private boolean allRequired;
        private boolean bonusAllowed;
    }

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class AttendanceConfigPayload {
        @Builder.Default
        private List<Integer> servantEntryOpenDays = new ArrayList<>(List.of(4, 5, 6, 0, 1));

        @Builder.Default
        private List<Integer> servantSelectableEventDays = new ArrayList<>(List.of(4, 5, 6));

        @Builder.Default
        private Boolean allowCustomTitleOnNonDefaultDays = true;

        @Builder.Default
        private Map<String, String> typeLabels = defaultTypeLabels();

        @Builder.Default
        private Map<String, List<Integer>> typeDays = defaultTypeDays();

        @Builder.Default
        private Map<String, Map<String, List<Integer>>> familyTypeDays = new LinkedHashMap<>();

        @Builder.Default
        private Map<String, List<Integer>> familyAbsenceAllowedDays = new LinkedHashMap<>();

        @Builder.Default
        private Map<String, List<Integer>> familyAbsenceOpenDays = new LinkedHashMap<>();

        @Builder.Default
        private List<CustomEventConfig> customEvents = new ArrayList<>();

        @Builder.Default
        private List<AttendanceRuleGroup> attendanceRuleGroups = new ArrayList<>();

        @Builder.Default
        private Map<String, List<String>> typeAbsenceModes = new LinkedHashMap<>();

        @Builder.Default
        private Map<String, List<Integer>> typeAbsenceModeDays = new LinkedHashMap<>();
    }

    public AttendanceConfigPayload getAttendanceConfig() {
        return appSettingRepository.findBySettingKey(ATTENDANCE_CONFIG_KEY)
                .map(this::fromSetting)
                .orElseGet(AttendanceConfigService::defaultConfig);
    }

    public AttendanceConfigPayload saveAttendanceConfig(AttendanceConfigPayload payload, String updatedBy) {
        AttendanceConfigPayload normalized = normalize(payload);
        AppSetting setting = appSettingRepository.findBySettingKey(ATTENDANCE_CONFIG_KEY)
                .orElseGet(() -> AppSetting.builder().settingKey(ATTENDANCE_CONFIG_KEY).build());
        setting.setSettingValue(toJson(normalized));
        setting.setUpdatedBy(updatedBy);
        appSettingRepository.save(setting);
        return normalized;
    }

    public AttendanceConfigPayload saveFamilySchedule(String familyBase,
                                                      Map<String, List<Integer>> familyDays,
                                                      List<Integer> absenceAllowedDays,
                                                      List<Integer> absenceOpenDays,
                                                      String updatedBy) {
        String normalizedFamily = clean(familyBase);
        if (normalizedFamily == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "FAMILY_REQUIRED", "Family is required");
        }

        AttendanceConfigPayload current = getAttendanceConfig();

        Map<String, Map<String, List<Integer>>> updatedFamilyTypeDays = new LinkedHashMap<>(
                current.getFamilyTypeDays() == null ? Map.of() : current.getFamilyTypeDays()
        );
        updatedFamilyTypeDays.put(normalizedFamily, normalizeTypeDaysMap(familyDays, null));

        Map<String, List<Integer>> updatedAbsenceAllowed = new LinkedHashMap<>(
                current.getFamilyAbsenceAllowedDays() == null ? Map.of() : current.getFamilyAbsenceAllowedDays()
        );
        updatedAbsenceAllowed.put(normalizedFamily, normalizeDays(absenceAllowedDays, List.of()));

        Map<String, List<Integer>> updatedAbsenceOpen = new LinkedHashMap<>(
                current.getFamilyAbsenceOpenDays() == null ? Map.of() : current.getFamilyAbsenceOpenDays()
        );
        updatedAbsenceOpen.put(normalizedFamily, normalizeDays(absenceOpenDays, List.of()));

        current.setFamilyTypeDays(updatedFamilyTypeDays);
        current.setFamilyAbsenceAllowedDays(updatedAbsenceAllowed);
        current.setFamilyAbsenceOpenDays(updatedAbsenceOpen);
        current.setServantSelectableEventDays(computeSelectableEventDays(current));
        return saveAttendanceConfig(current, updatedBy);
    }

    public CustomEventConfig saveCustomEvent(CustomEventConfig raw, String updatedBy) {
        CustomEventConfig normalized = normalizeCustomEvent(raw, true);
        AttendanceConfigPayload current = getAttendanceConfig();
        List<CustomEventConfig> events = new ArrayList<>(current.getCustomEvents() == null ? List.of() : current.getCustomEvents());

        boolean replaced = false;
        for (int i = 0; i < events.size(); i++) {
            CustomEventConfig existing = events.get(i);
            if (existing != null && Objects.equals(existing.getId(), normalized.getId())) {
                events.set(i, normalized);
                replaced = true;
                break;
            }
        }
        if (!replaced) {
            events.add(normalized);
        }

        current.setCustomEvents(events);
        saveAttendanceConfig(current, updatedBy);
        return normalized;
    }

    public boolean deleteCustomEvent(String id, String updatedBy) {
        String wantedId = clean(id);
        if (wantedId == null) return false;
        AttendanceConfigPayload current = getAttendanceConfig();
        List<CustomEventConfig> events = new ArrayList<>(current.getCustomEvents() == null ? List.of() : current.getCustomEvents());
        boolean removed = events.removeIf(event -> event != null && wantedId.equals(event.getId()));
        if (removed) {
            current.setCustomEvents(events);
            saveAttendanceConfig(current, updatedBy);
        }
        return removed;
    }

    public Optional<CustomEventConfig> findCustomEventById(String id) {
        String wantedId = clean(id);
        if (wantedId == null) return Optional.empty();
        return normalize(getAttendanceConfig()).getCustomEvents().stream()
                .filter(event -> event != null && wantedId.equals(event.getId()))
                .findFirst();
    }

    public List<CustomEventConfig> customEventsForFamily(String familyBase) {
        String normalizedFamily = clean(familyBase);
        return normalize(getAttendanceConfig()).getCustomEvents().stream()
                .filter(event -> event != null && Objects.equals(clean(event.getFamilyBase()), normalizedFamily))
                .toList();
    }

    public boolean isCustomEventAvailable(CustomEventConfig event, String familyBase, LocalDate date) {
        if (event == null || date == null) return false;
        if (Boolean.FALSE.equals(event.getEnabled())) return false;
        if (!Objects.equals(clean(event.getFamilyBase()), clean(familyBase))) return false;
        if (event.getDayOfWeek() == null || event.getDayOfWeek() < 0 || event.getDayOfWeek() > 6) return false;
        int dow = date.getDayOfWeek().getValue() % 7;
        if (!Objects.equals(event.getDayOfWeek(), dow)) return false;
        if (!Boolean.TRUE.equals(event.getAlwaysActive())) {
            if (event.getActiveFrom() != null && date.isBefore(event.getActiveFrom())) return false;
            if (event.getActiveTo() != null && date.isAfter(event.getActiveTo())) return false;
        }
        return true;
    }

    public AttendanceConfigPayload defaultConfigPayload() {
        return defaultConfig();
    }

    public boolean isTodayOpenForServant() {
        int dow = LocalDate.now().getDayOfWeek().getValue() % 7;
        return new HashSet<>(getAttendanceConfig().getServantEntryOpenDays()).contains(dow);
    }

    public boolean isSelectableEventDay(int dow) {
        return new HashSet<>(getAttendanceConfig().getServantSelectableEventDays()).contains(dow);
    }

    public Map<String, String> labels() {
        return getAttendanceConfig().getTypeLabels();
    }

    public List<Integer> daysForType(AttendanceType type, String familyBase) {
        AttendanceConfigPayload cfg = getAttendanceConfig();
        String typeKey = type == null ? null : type.name();
        if (typeKey == null) return List.of();

        String base = clean(familyBase);
        if (base != null && cfg.getFamilyTypeDays() != null) {
            Map<String, List<Integer>> familyMap = cfg.getFamilyTypeDays().get(base);
            if (familyMap != null) {
                List<Integer> specific = normalizeDays(familyMap.get(typeKey), List.of());
                if (!specific.isEmpty()) return specific;
            }
        }

        Map<String, List<Integer>> typeDays = cfg.getTypeDays() == null ? defaultTypeDays() : cfg.getTypeDays();
        return normalizeDays(typeDays.get(typeKey), defaultTypeDays().getOrDefault(typeKey, List.of()));
    }

    public List<Integer> absenceAllowedDaysForFamily(String familyBase) {
        AttendanceConfigPayload cfg = getAttendanceConfig();
        String base = clean(familyBase);
        if (base != null && cfg.getFamilyAbsenceAllowedDays() != null) {
            List<Integer> specific = normalizeDays(cfg.getFamilyAbsenceAllowedDays().get(base), List.of());
            if (!specific.isEmpty()) return specific;
        }
        return normalizeDays(cfg.getServantSelectableEventDays(), List.of(4, 5, 6));
    }

    public List<Integer> absenceOpenDaysForFamily(String familyBase) {
        AttendanceConfigPayload cfg = getAttendanceConfig();
        String base = clean(familyBase);
        if (base != null && cfg.getFamilyAbsenceOpenDays() != null) {
            List<Integer> specific = normalizeDays(cfg.getFamilyAbsenceOpenDays().get(base), List.of());
            if (!specific.isEmpty()) return specific;
        }
        return normalizeDays(cfg.getServantEntryOpenDays(), List.of(4, 5, 6, 0, 1));
    }

    private AttendanceConfigPayload fromSetting(AppSetting setting) {
        try {
            JsonNode root = objectMapper.readTree(setting.getSettingValue());
            migrateAbsenceModes((ObjectNode) root);
            AttendanceConfigPayload parsed = objectMapper.treeToValue(root, AttendanceConfigPayload.class);
            return normalize(parsed);
        } catch (Exception ex) {
            return defaultConfig();
        }
    }

    /**
     * Migrate old typeAbsenceModes format (Map&lt;String, String&gt;) to new format (Map&lt;String, List&lt;String&gt;&gt;).
     * Also ensure typeAbsenceModeDays exists.
     */
    private void migrateAbsenceModes(ObjectNode root) {
        JsonNode modes = root.get("typeAbsenceModes");
        if (modes != null && modes.isObject()) {
            ObjectNode modesObj = (ObjectNode) modes;
            // Check if any value is a text (old format) instead of array
            boolean needsMigration = false;
            Iterator<String> it = modesObj.fieldNames();
            while (it.hasNext()) {
                JsonNode val = modesObj.get(it.next());
                if (val != null && val.isTextual()) {
                    needsMigration = true;
                    break;
                }
            }
            if (needsMigration) {
                ObjectNode newModes = objectMapper.createObjectNode();
                Iterator<String> it2 = modesObj.fieldNames();
                while (it2.hasNext()) {
                    String key = it2.next();
                    JsonNode val = modesObj.get(key);
                    if (val != null && val.isTextual()) {
                        ArrayNode arr = objectMapper.createArrayNode();
                        arr.add(val.asText());
                        newModes.set(key, arr);
                    } else {
                        newModes.set(key, val);
                    }
                }
                root.set("typeAbsenceModes", newModes);
            }
        } else if (modes == null) {
            root.putObject("typeAbsenceModes");
        }
        if (!root.has("typeAbsenceModeDays")) {
            root.putObject("typeAbsenceModeDays");
        }
    }

    private String toJson(AttendanceConfigPayload payload) {
        try {
            return objectMapper.writeValueAsString(payload);
        } catch (JsonProcessingException e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "CONFIG_SERIALIZATION_FAILED", "Failed to save config");
        }
    }

    public AttendanceConfigPayload normalize(AttendanceConfigPayload raw) {
        AttendanceConfigPayload cfg = raw == null ? defaultConfig() : raw;

        List<Integer> openDays = normalizeDays(cfg.getServantEntryOpenDays(), List.of(4, 5, 6, 0, 1));
        Map<String, List<Integer>> typeDays = normalizeTypeDaysMap(cfg.getTypeDays(), defaultTypeDays());
        Map<String, Map<String, List<Integer>>> familyTypeDays = normalizeFamilyTypeDays(cfg.getFamilyTypeDays());
        Map<String, List<Integer>> familyAbsenceAllowedDays = normalizeSimpleDayMap(cfg.getFamilyAbsenceAllowedDays());
        Map<String, List<Integer>> familyAbsenceOpenDays = normalizeSimpleDayMap(cfg.getFamilyAbsenceOpenDays());

        Map<String, String> labels = new LinkedHashMap<>(defaultTypeLabels());
        if (cfg.getTypeLabels() != null) {
            cfg.getTypeLabels().forEach((k, v) -> {
                if (k != null && !k.isBlank() && v != null && !v.isBlank()) {
                    labels.put(k.trim().toUpperCase(Locale.ROOT), v.trim());
                }
            });
        }

        List<CustomEventConfig> customEvents = normalizeCustomEvents(cfg.getCustomEvents());

        List<AttendanceRuleGroup> ruleGroups = cfg.getAttendanceRuleGroups() == null
                ? new ArrayList<>()
                : cfg.getAttendanceRuleGroups();

        Map<String, List<String>> typeAbsenceModes = normalizeAbsenceModes(cfg.getTypeAbsenceModes());

        Map<String, List<Integer>> typeAbsenceModeDays = normalizeAbsenceModeDays(cfg.getTypeAbsenceModeDays());

        return AttendanceConfigPayload.builder()
                .servantEntryOpenDays(openDays)
                .servantSelectableEventDays(computeSelectableEventDays(typeDays, familyTypeDays, customEvents))
                .allowCustomTitleOnNonDefaultDays(cfg.getAllowCustomTitleOnNonDefaultDays() == null ? Boolean.TRUE : cfg.getAllowCustomTitleOnNonDefaultDays())
                .typeLabels(labels)
                .typeDays(typeDays)
                .familyTypeDays(familyTypeDays)
                .familyAbsenceAllowedDays(familyAbsenceAllowedDays)
                .familyAbsenceOpenDays(familyAbsenceOpenDays)
                .customEvents(customEvents)
                .attendanceRuleGroups(ruleGroups)
                .typeAbsenceModes(typeAbsenceModes)
                .typeAbsenceModeDays(typeAbsenceModeDays)
                .build();
    }

    private static List<Integer> computeSelectableEventDays(AttendanceConfigPayload cfg) {
        return computeSelectableEventDays(
                cfg == null ? null : cfg.getTypeDays(),
                cfg == null ? null : cfg.getFamilyTypeDays(),
                cfg == null ? null : cfg.getCustomEvents()
        );
    }

    private static List<Integer> computeSelectableEventDays(Map<String, List<Integer>> typeDays,
                                                            Map<String, Map<String, List<Integer>>> familyTypeDays,
                                                            List<CustomEventConfig> customEvents) {
        LinkedHashSet<Integer> out = new LinkedHashSet<>();
        normalizeTypeDaysMap(typeDays, defaultTypeDays()).values().forEach(days -> out.addAll(normalizeDays(days, List.of())));
        normalizeFamilyTypeDays(familyTypeDays).values().forEach(map ->
                normalizeTypeDaysMap(map, null).values().forEach(days -> out.addAll(normalizeDays(days, List.of())))
        );
        normalizeCustomEvents(customEvents).forEach(event -> {
            if (event.getDayOfWeek() != null) out.add(event.getDayOfWeek());
        });
        if (out.isEmpty()) out.addAll(List.of(4, 5, 6));
        return new ArrayList<>(out);
    }

    private static Map<String, List<Integer>> normalizeTypeDaysMap(Map<String, List<Integer>> raw,
                                                                   Map<String, List<Integer>> fallback) {
        Map<String, List<Integer>> defaults = fallback == null ? Map.of() : fallback;
        Map<String, List<Integer>> out = new LinkedHashMap<>();

        for (String key : defaultTypeDays().keySet()) {
            List<Integer> source = raw == null ? null : raw.get(key);
            List<Integer> fb = defaults.getOrDefault(key, List.of());
            List<Integer> normalized = normalizeDays(source, fb);
            if (!normalized.isEmpty()) {
                out.put(key, normalized);
            } else if (fallback != null && !fb.isEmpty()) {
                out.put(key, new ArrayList<>(fb));
            }
        }

        if (raw != null) {
            raw.forEach((k, v) -> {
                String key = k == null ? null : k.trim().toUpperCase(Locale.ROOT);
                if (key == null || key.isBlank() || !defaultTypeDays().containsKey(key)) return;
                List<Integer> normalized = normalizeDays(v, out.getOrDefault(key, List.of()));
                if (!normalized.isEmpty()) out.put(key, normalized);
            });
        }

        return out;
    }

    private static Map<String, Map<String, List<Integer>>> normalizeFamilyTypeDays(Map<String, Map<String, List<Integer>>> raw) {
        Map<String, Map<String, List<Integer>>> out = new LinkedHashMap<>();
        if (raw == null) return out;
        raw.forEach((familyBase, typeMap) -> {
            String base = clean(familyBase);
            if (base == null) return;
            Map<String, List<Integer>> normalized = normalizeTypeDaysMap(typeMap, null);
            if (!normalized.isEmpty()) out.put(base, normalized);
        });
        return out;
    }

    private static Map<String, List<Integer>> normalizeSimpleDayMap(Map<String, List<Integer>> raw) {
        Map<String, List<Integer>> out = new LinkedHashMap<>();
        if (raw == null) return out;
        raw.forEach((key, value) -> {
            String normalizedKey = clean(key);
            if (normalizedKey == null) return;
            List<Integer> normalizedDays = normalizeDays(value, List.of());
            if (!normalizedDays.isEmpty()) out.put(normalizedKey, normalizedDays);
        });
        return out;
    }

    private static List<CustomEventConfig> normalizeCustomEvents(List<CustomEventConfig> raw) {
        List<CustomEventConfig> out = new ArrayList<>();
        if (raw == null) return out;
        Set<String> seen = new LinkedHashSet<>();
        for (CustomEventConfig item : raw) {
            try {
                CustomEventConfig normalized = normalizeCustomEvent(item, false);
                if (normalized == null || normalized.getId() == null || seen.contains(normalized.getId())) continue;
                seen.add(normalized.getId());
                out.add(normalized);
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    private static Map<String, List<String>> normalizeAbsenceModes(Map<String, List<String>> raw) {
        Map<String, List<String>> out = new LinkedHashMap<>();
        if (raw == null) return out;
        Set<String> valid = Set.of("PRIMARY", "ALTERNATIVE", "ALTERNATIVE_BONUS", "BONUS_ONLY");
        raw.forEach((k, v) -> {
            String key = k == null ? null : k.trim().toUpperCase(Locale.ROOT);
            if (key == null || key.isBlank()) return;
            if (v == null || v.isEmpty()) return;
            List<String> normalizedValues = new ArrayList<>();
            for (String mode : v) {
                if (mode == null) continue;
                String val = mode.trim().toUpperCase(Locale.ROOT);
                if (valid.contains(val)) {
                    normalizedValues.add(val);
                }
            }
            if (!normalizedValues.isEmpty()) {
                out.put(key, normalizedValues);
            }
        });
        return out;
    }

    private static Map<String, List<Integer>> normalizeAbsenceModeDays(Map<String, List<Integer>> raw) {
        Map<String, List<Integer>> out = new LinkedHashMap<>();
        if (raw == null) return out;
        raw.forEach((k, v) -> {
            String key = k == null ? null : k.trim().toUpperCase(Locale.ROOT);
            if (key == null || key.isBlank()) return;
            List<Integer> days = normalizeDays(v, List.of());
            if (!days.isEmpty()) {
                out.put(key, days);
            }
        });
        return out;
    }

    private static CustomEventConfig normalizeCustomEvent(CustomEventConfig raw, boolean generateIdWhenMissing) {
        if (raw == null) return null;
        String familyBase = clean(raw.getFamilyBase());
        String title = clean(raw.getTitle());
        Integer day = raw.getDayOfWeek();
        if (familyBase == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CUSTOM_EVENT_FAMILY_REQUIRED", "familyBase is required");
        }
        if (title == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CUSTOM_EVENT_TITLE_REQUIRED", "title is required");
        }
        if (day == null || day < 0 || day > 6) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "CUSTOM_EVENT_DAY_REQUIRED", "dayOfWeek is required");
        }

        String id = clean(raw.getId());
        if (id == null && generateIdWhenMissing) {
            id = UUID.randomUUID().toString();
        }
        if (id == null) return null;

        boolean alwaysActive = !Boolean.FALSE.equals(raw.getAlwaysActive());
        LocalDate from = raw.getActiveFrom();
        LocalDate to = raw.getActiveTo();
        if (!alwaysActive && from != null && to != null && from.isAfter(to)) {
            LocalDate tmp = from;
            from = to;
            to = tmp;
        }
        if (alwaysActive) {
            from = null;
            to = null;
        }

        return CustomEventConfig.builder()
                .id(id)
                .familyBase(familyBase)
                .title(title)
                .dayOfWeek(day)
                .enabled(raw.getEnabled() == null ? Boolean.TRUE : raw.getEnabled())
                .alwaysActive(alwaysActive)
                .activeFrom(from)
                .activeTo(to)
                .build();
    }

    private static List<Integer> normalizeDays(List<Integer> raw, List<Integer> fallback) {
        LinkedHashSet<Integer> out = new LinkedHashSet<>();
        if (raw != null) {
            for (Integer x : raw) {
                if (x != null && x >= 0 && x <= 6) out.add(x);
            }
        }
        if (out.isEmpty() && fallback != null) out.addAll(fallback);
        return new ArrayList<>(out);
    }

    private static AttendanceConfigPayload defaultConfig() {
        return AttendanceConfigPayload.builder()
                .typeDays(defaultTypeDays())
                .familyTypeDays(new LinkedHashMap<>())
                .familyAbsenceAllowedDays(new LinkedHashMap<>())
                .familyAbsenceOpenDays(new LinkedHashMap<>())
                .customEvents(new ArrayList<>())
                .typeAbsenceModes(new LinkedHashMap<>())
                .typeAbsenceModeDays(new LinkedHashMap<>())
                .build();
    }

    private static Map<String, String> defaultTypeLabels() {
        Map<String, String> labels = new LinkedHashMap<>();
        labels.put("FRIDAY_LITURGY", "قداس");
        labels.put("TASBEEHA", "تسبحة");
        labels.put("FAMILY_MEETING", "اجتماع الأسرة");
        labels.put("MARMARKOS_KHORS", "خورس مارمرقس");
        labels.put("ATHANASIUS_KHORS", "خورس البابا أثناسيوس");
        labels.put("CUSTOM_EVENT", "مناسبة مخصصة");
        return labels;
    }

    private static Map<String, List<Integer>> defaultTypeDays() {
        Map<String, List<Integer>> out = new LinkedHashMap<>();
        out.put("FRIDAY_LITURGY", new ArrayList<>(List.of(5)));
        out.put("TASBEEHA", new ArrayList<>(List.of(6)));
        out.put("FAMILY_MEETING", new ArrayList<>(List.of(4)));
        out.put("MARMARKOS_KHORS", new ArrayList<>(List.of(5)));
        out.put("ATHANASIUS_KHORS", new ArrayList<>(List.of(5)));
        return out;
    }

    private static String clean(String value) {
        String x = String.valueOf(value == null ? "" : value).trim();
        return x.isBlank() ? null : x;
    }
}