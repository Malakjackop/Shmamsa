package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceAccessGrant;
import com.shmamsa.model.AttendanceGrantKind;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.CustomAttendanceEvent;
import com.shmamsa.model.FamilyRoleCode;
import com.shmamsa.model.User;
import com.shmamsa.model.UserFamilyAssignmentView;
import com.shmamsa.repository.CustomAttendanceEventRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.AttendanceAccessGrantService;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.UserFamilyRoleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

@RestController
@RequestMapping("/api/attendance/custom-events")
@RequiredArgsConstructor
public class CustomAttendanceEventController {

    private final CustomAttendanceEventRepository repo;
    private final UserRepository userRepo;
    private final UserFamilyRoleService userFamilyRoleService;
    private final FamilyAccessService familyAccessService;
    private final AttendanceAccessGrantService attendanceAccessGrantService;

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        }

        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private String normRole(String raw) {
        if (raw == null) return "";

        String role = raw.trim();
        String upper = role.toUpperCase(Locale.ROOT).replaceAll("[-\\s]+", "_");
        if (upper.startsWith("ROLE_")) upper = upper.substring(5);

        String ar = role.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .trim()
                .replaceAll("\\s+", " ");

        if (ar.equals("خادم")) return "KHADIM";
        if (ar.equals("امين اسرة") || ar.equals("أمين أسرة") || ar.equals("امين الاسرة")
                || ar.equals("أمين الاسره") || ar.equals("امين الأسرة")) {
            return "AMIN_OSRA";
        }
        if (ar.equals("امين خدمة") || ar.equals("أمين خدمة") || ar.equals("امين الخدمه")
                || ar.equals("أمين الخدمه")) {
            return "AMIN_KHEDMA";
        }

        return upper;
    }

    private boolean isAminKhedmaOrDev(User user) {
        String role = normRole(user.getRole());
        return "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role) || "DEV".equals(role);
    }

    private boolean hasAminOsraAssignment(User user) {
        return userFamilyRoleService.getAssignments(user).stream()
                .map(this::normAssignmentRole)
                .anyMatch("AMIN_OSRA"::equals);
    }

    private List<String> aminOsraFamilies(User user) {
        List<String> families = new ArrayList<>(userFamilyRoleService.getAssignments(user).stream()
                .filter(a -> "AMIN_OSRA".equals(normAssignmentRole(a)))
                .map(a -> familyAccessService.baseNameForId(a.getFamilyId(), a.getFamilyName()))
                .filter(f -> f != null && !f.isBlank())
                .map(String::trim)
                .distinct()
                .toList());

        if ("AMIN_OSRA".equals(normRole(user.getRole()))) {
            String base = familyAccessService.baseFamily(user);
            if (base != null && !base.isBlank() && families.stream().noneMatch(f -> f.equalsIgnoreCase(base.trim()))) {
                families.add(base.trim());
            }
        }

        return families;
    }

    private String normAssignmentRole(UserFamilyAssignmentView assignment) {
        if (assignment == null) return "";
        Integer roleCode = assignment.getRoleCode();
        if (roleCode != null) {
            return FamilyRoleCode.fromCode(roleCode).getRoleName();
        }
        return normRole(assignment.getRole());
    }

    private boolean canManage(User user) {
        return isAminKhedmaOrDev(user)
                || "AMIN_OSRA".equals(normRole(user.getRole()))
                || hasAminOsraAssignment(user);
    }

    private void assertFamilyPermission(User user, String familyBase) {
        if (isAminKhedmaOrDev(user)) return;

        if (familyBase == null || familyBase.isBlank()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "فقط أمين الخدمة أو المطور يمكنه إنشاء مناسبة لكل الأسر");
        }

        String requestedBase = familyAccessService.baseNameForName(familyBase);
        if (requestedBase == null || requestedBase.isBlank()) {
            requestedBase = familyBase.trim();
        }
        final String targetBase = requestedBase.trim();

        boolean allowed = aminOsraFamilies(user).stream()
                .anyMatch(f -> f.equalsIgnoreCase(targetBase));
        if (!allowed) {
            throw new ApiException(HttpStatus.FORBIDDEN, "لا يمكنك إنشاء أو تعديل مناسبة لهذه الأسرة");
        }
    }

    private boolean isSameUser(User a, User b) {
        return a != null
                && b != null
                && a.getId() != null
                && b.getId() != null
                && Objects.equals(a.getId(), b.getId());
    }

    private boolean isPermittedEditor(User user, CustomAttendanceEvent event) {
        if (event == null || user == null || event.getPermittedEditors() == null) return false;
        return event.getPermittedEditors().stream().anyMatch(editor -> isSameUser(user, editor));
    }

    private boolean canManageEventFamily(User user, CustomAttendanceEvent event) {
        if (event == null || user == null) return false;
        String eventFamily = event.getFamilyBase();
        if (eventFamily == null || eventFamily.isBlank()) return canManage(user);

        String eventBase = familyAccessService.baseNameForName(eventFamily);
        if (eventBase == null || eventBase.isBlank()) {
            eventBase = eventFamily.trim();
        }
        final String targetBase = eventBase.trim();

        return aminOsraFamilies(user).stream().anyMatch(f -> f.equalsIgnoreCase(targetBase));
    }

    private boolean canEditEvent(User user, CustomAttendanceEvent event) {
        if (event == null || user == null) return false;
        if (canManage(user)) return true;
        if (isSameUser(user, event.getCreatedBy())) return true;
        if (isPermittedEditor(user, event)) return true;
        if (canManageEventFamily(user, event)) return true;
        return event.getCreatedBy() == null && isAminKhedmaOrDev(user);
    }

    private void assertEditPermission(User user, CustomAttendanceEvent event) {
        if (!canEditEvent(user, event)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "لا يمكنك تعديل هذه المناسبة");
        }
    }

    private Set<User> permittedEditorsFrom(Map<String, Object> body) {
        Set<Long> ids = new LinkedHashSet<>();

        addEditorIds(ids, body.get("permittedEditorIds"));

        // Backward compatibility with the old single-select payload.
        if (ids.isEmpty()) {
            addEditorIds(ids, body.get("permittedEditorId"));
        }

        if (ids.isEmpty()) return new LinkedHashSet<>();
        return new LinkedHashSet<>(userRepo.findAllById(ids));
    }

    private void addEditorIds(Set<Long> ids, Object raw) {
        if (raw == null) return;

        if (raw instanceof Iterable<?> iterable) {
            for (Object item : iterable) addEditorId(ids, item);
            return;
        }

        addEditorId(ids, raw);
    }

    private void addEditorId(Set<Long> ids, Object raw) {
        if (raw == null) return;
        String value = raw.toString().trim();
        if (value.isBlank() || "null".equalsIgnoreCase(value)) return;

        try {
            ids.add(Long.parseLong(value));
        } catch (NumberFormatException ignored) {
            // Ignore invalid ids instead of failing the whole request.
        }
    }

    private List<CustomAttendanceEvent> visibleForFamily(String familyBase, boolean includeDisabled) {
        String base = familyBase == null ? "" : familyBase.trim();
        List<CustomAttendanceEvent> source = includeDisabled
                ? repo.findByOrderByDayOfWeekAscTitleAsc()
                : repo.findByEnabledTrueOrderByDayOfWeekAscTitleAsc();

        return source.stream()
                .filter(e -> {
                    String eventFamily = e.getFamilyBase();
                    if (eventFamily == null || eventFamily.isBlank()) return true;
                    return base.isBlank() || eventFamily.equalsIgnoreCase(base);
                })
                .sorted(Comparator.comparing(CustomAttendanceEvent::getDayOfWeek)
                        .thenComparing(CustomAttendanceEvent::getTitle))
                .toList();
    }


    private Set<AttendanceType> parseAttendanceTypesCsv(String csv) {
        Set<AttendanceType> out = new LinkedHashSet<>();
        if (csv == null || csv.isBlank()) return out;
        for (String part : csv.split(",")) {
            String value = String.valueOf(part == null ? "" : part).trim();
            if (value.isBlank()) continue;
            try {
                out.add(AttendanceType.valueOf(value.toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    private boolean grantAllowsCustomEvent(AttendanceAccessGrant grant) {
        if (grant == null) return false;
        Set<AttendanceType> types = parseAttendanceTypesCsv(grant.getAllowedTypesCsv());
        boolean customEventGrant = types.isEmpty() || types.contains(AttendanceType.CUSTOM_EVENT);
        if (!customEventGrant) return false;
        return grant.getGrantKind() == AttendanceGrantKind.TAKE_ATTENDANCE
                // Backward compatibility with old/wrong saved payloads.
                || grant.getGrantKind() == AttendanceGrantKind.SELF_CHECKIN;
    }

    private String normalizeFamilyKey(String familyName) {
        String base = familyAccessService.baseNameForName(familyName);
        if (base == null || base.isBlank()) {
            base = String.valueOf(familyName == null ? "" : familyName).trim();
        }
        return base
                .replaceAll("[\u064B-\u065F\u0670\u0640]", "")
                .replace("أ", "ا")
                .replace("إ", "ا")
                .replace("آ", "ا")
                .replace("ة", "ه")
                .replaceAll("\\s+", " ")
                .trim()
                .toLowerCase(Locale.ROOT);
    }

    private boolean sameFamilyBaseLoose(String a, String b) {
        String ak = normalizeFamilyKey(a);
        String bk = normalizeFamilyKey(b);
        return !ak.isBlank() && !bk.isBlank() && ak.equals(bk);
    }

    private List<String> grantFamilyParts(String rawValue) {
        String raw = String.valueOf(rawValue == null ? "" : rawValue).trim();
        if (raw.isBlank() || "ALL".equalsIgnoreCase(raw)) return List.of();
        return java.util.Arrays.stream(raw.split("[,،;|]+"))
                .map(String::trim)
                .filter(x -> !x.isBlank())
                .toList();
    }

    private boolean grantAllowsEventFamily(AttendanceAccessGrant grant, String eventFamily) {
        if (grant == null) return false;
        List<String> grantFamilies = grantFamilyParts(grant.getFamilyBase());
        if (grantFamilies.isEmpty()) return true;
        String eventBase = String.valueOf(eventFamily == null ? "" : eventFamily).trim();
        if (eventBase.isBlank()) return true;
        return grantFamilies.stream().anyMatch(family -> sameFamilyBaseLoose(family, eventBase));
    }

    private boolean eventMatchesRequestedFamily(CustomAttendanceEvent event, String requestedFamily) {
        String requested = String.valueOf(requestedFamily == null ? "" : requestedFamily).trim();
        if (requested.isBlank()) return true;
        String eventFamily = event == null ? null : event.getFamilyBase();
        if (eventFamily == null || eventFamily.isBlank()) return true;
        return sameFamilyBaseLoose(eventFamily, requested);
    }

    private List<CustomAttendanceEvent> delegatedVisibleEvents(User user, String familyBase) {
        if (user == null || user.getId() == null) return List.of();
        List<AttendanceAccessGrant> customEventGrants = attendanceAccessGrantService.visibleGrantsForUser(user.getId()).stream()
                .filter(this::grantAllowsCustomEvent)
                .toList();
        if (customEventGrants.isEmpty()) return List.of();

        return repo.findByEnabledTrueOrderByDayOfWeekAscTitleAsc().stream()
                .filter(event -> eventMatchesRequestedFamily(event, familyBase))
                .filter(event -> customEventGrants.stream().anyMatch(grant -> grantAllowsEventFamily(grant, event.getFamilyBase())))
                .sorted(Comparator.comparing(CustomAttendanceEvent::getDayOfWeek)
                        .thenComparing(CustomAttendanceEvent::getTitle))
                .toList();
    }

    private Map<String, Object> toMap(CustomAttendanceEvent e, User viewer) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", e.getId());
        m.put("familyBase", e.getFamilyBase());
        m.put("scope", e.getFamilyBase() == null || e.getFamilyBase().isBlank() ? "ALL" : "FAMILY");
        m.put("title", e.getTitle());
        m.put("dayOfWeek", e.getDayOfWeek());
        m.put("enabled", e.getEnabled());
        m.put("status", Boolean.FALSE.equals(e.getEnabled()) ? "PENDING" : "ACTIVE");
        m.put("alwaysActive", e.getAlwaysActive());
        m.put("activeFrom", e.getActiveFrom() != null ? e.getActiveFrom().toString() : null);
        m.put("activeTo", e.getActiveTo() != null ? e.getActiveTo().toString() : null);
        m.put("createdById", e.getCreatedBy() != null ? e.getCreatedBy().getId() : null);
        m.put("createdByName", e.getCreatedBy() != null ? e.getCreatedBy().getFullName() : null);

        List<Map<String, Object>> permittedEditors = new ArrayList<>();
        if (e.getPermittedEditors() != null) {
            e.getPermittedEditors().stream()
                    .filter(Objects::nonNull)
                    .sorted(Comparator.comparing(User::getFullName, Comparator.nullsLast(String::compareToIgnoreCase)))
                    .forEach(editor -> {
                        Map<String, Object> editorMap = new LinkedHashMap<>();
                        editorMap.put("id", editor.getId());
                        editorMap.put("fullName", editor.getFullName());
                        permittedEditors.add(editorMap);
                    });
        }

        m.put("permittedEditors", permittedEditors);
        m.put("permittedEditorIds", permittedEditors.stream().map(x -> x.get("id")).toList());
        m.put("permittedEditorNames", permittedEditors.stream().map(x -> x.get("fullName")).toList());
        m.put("permittedEditorId", permittedEditors.isEmpty() ? null : permittedEditors.get(0).get("id"));
        m.put("permittedEditorName", permittedEditors.isEmpty() ? null : permittedEditors.get(0).get("fullName"));
        m.put("canEdit", canEditEvent(viewer, e));
        m.put("createdAt", e.getCreatedAt() != null ? e.getCreatedAt().toString() : null);
        m.put("updatedAt", e.getUpdatedAt() != null ? e.getUpdatedAt().toString() : null);
        return m;
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<?> list(@RequestParam(required = false) String familyBase, Authentication auth) {
        User user = requireUser(auth);

        if (!canManage(user)) {
            Map<Long, CustomAttendanceEvent> visible = new LinkedHashMap<>();
            repo.findByOrderByDayOfWeekAscTitleAsc().stream()
                    .filter(e -> isPermittedEditor(user, e))
                    .filter(e -> eventMatchesRequestedFamily(e, familyBase))
                    .forEach(e -> visible.put(e.getId(), e));
            delegatedVisibleEvents(user, familyBase).forEach(e -> visible.put(e.getId(), e));
            return ResponseEntity.ok(visible.values().stream().map(e -> toMap(e, user)).toList());
        }

        List<CustomAttendanceEvent> events;
        if (isAminKhedmaOrDev(user)) {
            events = familyBase != null && !familyBase.isBlank()
                    ? visibleForFamily(familyBase, true)
                    : repo.findByOrderByDayOfWeekAscTitleAsc();
        } else {
            List<String> myFamilies = aminOsraFamilies(user);
            events = repo.findByOrderByDayOfWeekAscTitleAsc().stream()
                    .filter(e -> {
                        String eventFamily = e.getFamilyBase();
                        if (eventFamily == null || eventFamily.isBlank()) return true;
                        String eventBase = familyAccessService.baseNameForName(eventFamily);
                        if (eventBase == null || eventBase.isBlank()) {
                            eventBase = eventFamily.trim();
                        }
                        final String targetBase = eventBase.trim();
                        return myFamilies.stream().anyMatch(f -> f.equalsIgnoreCase(targetBase));
                    })
                    .toList();
        }

        return ResponseEntity.ok(events.stream().map(e -> toMap(e, user)).toList());
    }

    @PostMapping
    @Transactional
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body, Authentication auth) {
        User user = requireUser(auth);
        if (!canManage(user)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "غير مسموح");
        }

        String title = getString(body, "title");
        if (title == null || title.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "العنوان مطلوب"));
        }

        Integer dayOfWeek = getDayOfWeek(body.get("dayOfWeek"));
        if (dayOfWeek == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "يوم الأسبوع غير صحيح"));
        }

        String familyBase = getString(body, "familyBase");
        assertFamilyPermission(user, familyBase);

        boolean alwaysActive = getBool(body, "alwaysActive", true);
        LocalDate activeFrom = getDate(body, "activeFrom");
        LocalDate activeTo = getDate(body, "activeTo");
        if (!isValidDateRange(alwaysActive, activeFrom, activeTo)) {
            return ResponseEntity.badRequest().body(Map.of("error", "تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ البداية"));
        }

        CustomAttendanceEvent event = CustomAttendanceEvent.builder()
                .familyBase(familyBase == null || familyBase.isBlank() ? null : familyBase.trim())
                .title(title.trim())
                .dayOfWeek(dayOfWeek)
                .enabled(getBool(body, "enabled", true))
                .alwaysActive(alwaysActive)
                .activeFrom(alwaysActive ? null : activeFrom)
                .activeTo(alwaysActive ? null : activeTo)
                .createdBy(user)
                .permittedEditors(permittedEditorsFrom(body))
                .build();

        CustomAttendanceEvent saved = repo.save(event);
        saved = repo.findById(saved.getId()).orElse(saved);
        return ResponseEntity.ok(toMap(saved, user));
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String, Object> body, Authentication auth) {
        User user = requireUser(auth);
        CustomAttendanceEvent event = repo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "المناسبة غير موجودة"));

        assertEditPermission(user, event);

        String title = getString(body, "title");
        if (title != null && !title.isBlank()) {
            event.setTitle(title.trim());
        }

        if (body.containsKey("dayOfWeek")) {
            Integer dayOfWeek = getDayOfWeek(body.get("dayOfWeek"));
            if (dayOfWeek == null) {
                return ResponseEntity.badRequest().body(Map.of("error", "يوم الأسبوع غير صحيح"));
            }
            event.setDayOfWeek(dayOfWeek);
        }

        if (body.containsKey("familyBase")) {
            if (!canManage(user)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "لا يمكنك تغيير نطاق المناسبة");
            }
            String newFamilyBase = getString(body, "familyBase");
            assertFamilyPermission(user, newFamilyBase);
            event.setFamilyBase(newFamilyBase == null || newFamilyBase.isBlank() ? null : newFamilyBase.trim());
        }

        if (body.containsKey("enabled")) {
            event.setEnabled(getBool(body, "enabled", true));
        }

        if (body.containsKey("permittedEditorId") || body.containsKey("permittedEditorIds")) {
            event.setPermittedEditors(permittedEditorsFrom(body));
        }

        if (body.containsKey("alwaysActive")) {
            boolean alwaysActive = getBool(body, "alwaysActive", true);
            event.setAlwaysActive(alwaysActive);
            if (alwaysActive) {
                event.setActiveFrom(null);
                event.setActiveTo(null);
            } else {
                LocalDate from = getDate(body, "activeFrom");
                LocalDate to = getDate(body, "activeTo");
                if (!isValidDateRange(false, from, to)) {
                    return ResponseEntity.badRequest().body(Map.of("error", "تاريخ الانتهاء لا يمكن أن يكون قبل تاريخ البداية"));
                }
                event.setActiveFrom(from);
                event.setActiveTo(to);
            }
        }

        CustomAttendanceEvent saved = repo.save(event);
        saved = repo.findById(saved.getId()).orElse(saved);
        return ResponseEntity.ok(toMap(saved, user));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User user = requireUser(auth);
        CustomAttendanceEvent event = repo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "المناسبة غير موجودة"));

        assertEditPermission(user, event);
        repo.delete(event);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private String getString(Map<String, Object> body, String key) {
        Object value = body.get(key);
        if (value == null) return null;
        String text = value.toString().trim();
        return text.isBlank() || "null".equalsIgnoreCase(text) ? null : text;
    }

    private boolean getBool(Map<String, Object> body, String key, boolean defaultValue) {
        Object value = body.get(key);
        if (value == null) return defaultValue;
        return Boolean.parseBoolean(value.toString());
    }

    private LocalDate getDate(Map<String, Object> body, String key) {
        String text = getString(body, key);
        if (text == null) return null;
        try {
            return LocalDate.parse(text);
        } catch (Exception ignored) {
            return null;
        }
    }

    private Integer getDayOfWeek(Object raw) {
        if (raw == null) return null;
        try {
            int day = Integer.parseInt(raw.toString());
            return day >= 0 && day <= 6 ? day : null;
        } catch (Exception ignored) {
            return null;
        }
    }

    private boolean isValidDateRange(boolean alwaysActive, LocalDate activeFrom, LocalDate activeTo) {
        return alwaysActive || activeFrom == null || activeTo == null || !activeTo.isBefore(activeFrom);
    }
}
