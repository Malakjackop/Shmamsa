package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.CustomAttendanceEvent;
import com.shmamsa.model.User;
import com.shmamsa.model.UserFamilyAssignmentView;
import com.shmamsa.repository.CustomAttendanceEventRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.UserFamilyRoleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashSet;
import java.util.LinkedHashMap;
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

    // â”€â”€ permission helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        String username = auth.getName();
        return userRepo.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private String normRole(String raw) {
        if (raw == null) return "";
        String r = raw.trim();
        String upper = r.toUpperCase(Locale.ROOT).replaceAll("[-\\s]+", "_");
        String ar = r.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "").trim().replaceAll("\\s+", " ");
        if (ar.equals("Ø®Ø§Ø¯Ù…")) return "KHADIM";
        if (ar.equals("Ø§Ù…ÙŠÙ† Ø§Ø³Ø±Ø©") || ar.equals("Ø£Ù…ÙŠÙ† Ø£Ø³Ø±Ø©") || ar.equals("Ø§Ù…ÙŠÙ† Ø§Ù„Ø§Ø³Ø±Ø©") || ar.equals("Ø£Ù…ÙŠÙ† Ø§Ù„Ø§Ø³Ø±Ù‡") || ar.equals("Ø§Ù…ÙŠÙ† Ø§Ù„Ø£Ø³Ø±Ø©")) return "AMIN_OSRA";
        if (ar.equals("Ø§Ù…ÙŠÙ† Ø®Ø¯Ù…Ø©") || ar.equals("Ø£Ù…ÙŠÙ† Ø®Ø¯Ù…Ø©") || ar.equals("Ø§Ù…ÙŠÙ† Ø§Ù„Ø®Ø¯Ù…Ù‡") || ar.equals("Ø£Ù…ÙŠÙ† Ø§Ù„Ø®Ø¯Ù…Ù‡")) return "AMIN_KHEDMA";
        if (upper.startsWith("ROLE_")) return upper.substring(5);
        return upper;
    }

    private boolean isAminKhedmaOrDev(User user) {
        String role = normRole(user.getRole());
        return "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role) || "DEV".equals(role);
    }

    private boolean hasAminOsraAssignment(User user) {
        return userFamilyRoleService.getAssignments(user).stream()
                .map(UserFamilyAssignmentView::getRole)
                .map(this::normRole)
                .anyMatch("AMIN_OSRA"::equals);
    }

    /** Returns the list of family bases this user is AMIN_OSRA for, empty = none. */
    private List<String> aminOsraFamilies(User user) {
        return userFamilyRoleService.getAssignments(user).stream()
                .filter(a -> "AMIN_OSRA".equals(normRole(a.getRole())))
                .map(UserFamilyAssignmentView::getFamilyName)
                .filter(f -> f != null && !f.isBlank())
                .map(String::trim)
                .distinct()
                .toList();
    }

    /** True if this user may manage custom events at all. */
    private boolean canManage(User user) {
        if (isAminKhedmaOrDev(user)) return true;
        if ("AMIN_OSRA".equals(normRole(user.getRole()))) return true;
        return hasAminOsraAssignment(user);
    }

    /**
     * Asserts the caller may create/edit/delete a custom event for {@code familyBase}.
     * Null/blank familyBase = "all families" â€” only AMIN_KHEDMA / DEVELOPER may use that.
     */
    private void assertFamilyPermission(User user, String familyBase) {
        if (isAminKhedmaOrDev(user)) return;

        if (familyBase == null || familyBase.isBlank()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "ÙÙ‚Ø· Ø£Ù…ÙŠÙ† Ø§Ù„Ø®Ø¯Ù…Ø© ÙŠÙ…ÙƒÙ†Ù‡ Ø¥Ø¶Ø§ÙØ© Ù…Ù†Ø§Ø³Ø¨Ø© Ù„ÙƒÙ„ Ø§Ù„Ø£Ø³Ø±");
        }

        // AMIN_OSRA: must belong to that family
        List<String> myFamilies = aminOsraFamilies(user);
        boolean allowed = myFamilies.stream()
                .anyMatch(f -> f.equalsIgnoreCase(familyBase.trim()));
        if (!allowed) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ Ø¥Ø¶Ø§ÙØ© Ù…Ù†Ø§Ø³Ø¨Ø© Ù„Ù‡Ø°Ù‡ Ø§Ù„Ø£Ø³Ø±Ø©");
        }
    }

    private boolean isSameUser(User a, User b) {
        if (a == null || b == null || a.getId() == null || b.getId() == null) return false;
        return Objects.equals(a.getId(), b.getId());
    }

    private boolean isPermittedEditor(User user, CustomAttendanceEvent event) {
        if (event == null || user == null || event.getPermittedEditors() == null) return false;
        return event.getPermittedEditors().stream().anyMatch(editor -> isSameUser(user, editor));
    }

    private boolean canEditEvent(User user, CustomAttendanceEvent event) {
        if (event == null || user == null) return false;
        if (isSameUser(user, event.getCreatedBy())) return true;
        if (isPermittedEditor(user, event)) return true;
        return event.getCreatedBy() == null && isAminKhedmaOrDev(user);
    }

    private void assertEditPermission(User user, CustomAttendanceEvent event) {
        if (!canEditEvent(user, event)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Ù„Ø§ ÙŠÙ…ÙƒÙ†Ùƒ ØªØ¹Ø¯ÙŠÙ„ Ù‡Ø°Ù‡ Ø§Ù„Ù…Ù†Ø§Ø³Ø¨Ø©");
        }
    }

    private Set<User> permittedEditorsFrom(Map<String, Object> body) {
        Set<Long> ids = new LinkedHashSet<>();

        if (body.containsKey("permittedEditorIds")) {
            Object raw = body.get("permittedEditorIds");
            if (raw instanceof Iterable<?> iterable) {
                for (Object item : iterable) {
                    if (item == null) continue;
                    try {
                        ids.add(Long.parseLong(item.toString().trim()));
                    } catch (Exception ignored) {
                    }
                }
            }
        }

        // Backward compatibility with old single-select payload.
        if (ids.isEmpty() && body.containsKey("permittedEditorId")) {
            Object raw = body.get("permittedEditorId");
            if (raw != null && !raw.toString().trim().isBlank()) {
                try {
                    ids.add(Long.parseLong(raw.toString().trim()));
                } catch (Exception ignored) {
                }
            }
        }

        if (ids.isEmpty()) return new LinkedHashSet<>();

        return new LinkedHashSet<>(userRepo.findAllById(ids));
    }

    private List<CustomAttendanceEvent> visibleForFamily(String familyBase, boolean includeDisabled) {
        String base = familyBase == null ? "" : familyBase.trim();
        List<CustomAttendanceEvent> source = includeDisabled
                ? repo.findByOrderByDayOfWeekAscTitleAsc()
                : repo.findByEnabledTrueOrderByDayOfWeekAscTitleAsc();
        return source.stream()
                .filter(e -> {
                    String fb = e.getFamilyBase();
                    if (fb == null || fb.isBlank()) return true;
                    return base.isBlank() || fb.equalsIgnoreCase(base);
                })
                .sorted(Comparator.comparing(CustomAttendanceEvent::getDayOfWeek).thenComparing(CustomAttendanceEvent::getTitle))
                .toList();
    }

    // â”€â”€ serialization helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private boolean visibleToPermittedEditor(User user, CustomAttendanceEvent event) {
        return isPermittedEditor(user, event);
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

    // â”€â”€ endpoints â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<?> list(@RequestParam(required = false) String familyBase, Authentication auth) {
        User user = requireUser(auth);

        if (!canManage(user)) {
            List<CustomAttendanceEvent> permittedEvents = repo.findByOrderByDayOfWeekAscTitleAsc().stream()
                    .filter(e -> visibleToPermittedEditor(user, e))
                    .toList();
            return ResponseEntity.ok(permittedEvents.stream().map(e -> toMap(e, user)).toList());
        }

        List<CustomAttendanceEvent> events;
        if (isAminKhedmaOrDev(user)) {
            // With a selected family, show both family-specific and global events.
            // Without a selected family, show everything, including pending events.
            if (familyBase != null && !familyBase.isBlank()) {
                events = visibleForFamily(familyBase, true);
            } else {
                events = repo.findByOrderByDayOfWeekAscTitleAsc();
            }
        } else {
            // AMIN_OSRA: only their families + global events, including pending.
            List<String> myFamilies = aminOsraFamilies(user);
            events = repo.findByOrderByDayOfWeekAscTitleAsc().stream()
                    .filter(e -> {
                        String fb = e.getFamilyBase();
                        if (fb == null || fb.isBlank()) return true; // global events visible to all
                        return myFamilies.stream().anyMatch(f -> f.equalsIgnoreCase(fb.trim()));
                    })
                    .toList();
        }

        return ResponseEntity.ok(events.stream().map(e -> toMap(e, user)).toList());
    }

    @PostMapping
    @Transactional
    public ResponseEntity<?> create(@RequestBody Map<String, Object> body, Authentication auth) {
        User user = requireUser(auth);
        if (!canManage(user)) return ResponseEntity.status(403).body(Map.of("error", "ØºÙŠØ± Ù…Ø³Ù…ÙˆØ­"));

        String title = getString(body, "title");
        if (title == null || title.isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "Ø§Ù„Ø¹Ù†ÙˆØ§Ù† Ù…Ø·Ù„ÙˆØ¨"));
        }

        Object dowObj = body.get("dayOfWeek");
        if (dowObj == null) return ResponseEntity.badRequest().body(Map.of("error", "ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ Ù…Ø·Ù„ÙˆØ¨"));
        int dayOfWeek;
        try {
            dayOfWeek = Integer.parseInt(dowObj.toString());
        } catch (Exception e) {
            return ResponseEntity.badRequest().body(Map.of("error", "ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ ØºÙŠØ± ØµØ­ÙŠØ­"));
        }
        if (dayOfWeek < 0 || dayOfWeek > 6) {
            return ResponseEntity.badRequest().body(Map.of("error", "ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ ØºÙŠØ± ØµØ­ÙŠØ­"));
        }

        String familyBase = getString(body, "familyBase");
        assertFamilyPermission(user, familyBase);

        boolean alwaysActive = getBool(body, "alwaysActive", true);
        LocalDate activeFrom = getDate(body, "activeFrom");
        LocalDate activeTo = getDate(body, "activeTo");
        Set<User> permittedEditors = permittedEditorsFrom(body);

        if (!alwaysActive && activeFrom != null && activeTo != null && activeTo.isBefore(activeFrom)) {
            return ResponseEntity.badRequest().body(Map.of("error", "ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ø¡ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ù‚Ø¨Ù„ ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©"));
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
                .permittedEditors(permittedEditors)
                .build();

        event = repo.save(event);
        event = repo.findById(event.getId()).orElse(event);
        return ResponseEntity.ok(toMap(event, user));
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody Map<String, Object> body, Authentication auth) {
        User user = requireUser(auth);

        CustomAttendanceEvent event = repo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Ø§Ù„Ù…Ù†Ø§Ø³Ø¨Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©"));

        assertEditPermission(user, event);
        if (canManage(user)) assertFamilyPermission(user, event.getFamilyBase());

        String title = getString(body, "title");
        if (title != null && !title.isBlank()) event.setTitle(title.trim());

        if (body.containsKey("dayOfWeek") && body.get("dayOfWeek") != null) {
            int dow;
            try { dow = Integer.parseInt(body.get("dayOfWeek").toString()); }
            catch (Exception e) { return ResponseEntity.badRequest().body(Map.of("error", "ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ ØºÙŠØ± ØµØ­ÙŠØ­")); }
            if (dow < 0 || dow > 6) return ResponseEntity.badRequest().body(Map.of("error", "ÙŠÙˆÙ… Ø§Ù„Ø£Ø³Ø¨ÙˆØ¹ ØºÙŠØ± ØµØ­ÙŠØ­"));
            event.setDayOfWeek(dow);
        }

        if (body.containsKey("familyBase")) {
            String newFamilyBase = getString(body, "familyBase");
            if (!canManage(user)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "لا يمكنك تغيير نطاق المناسبة");
            }
            assertFamilyPermission(user, newFamilyBase);
            event.setFamilyBase(newFamilyBase == null || newFamilyBase.isBlank() ? null : newFamilyBase.trim());
        }

        if (body.containsKey("enabled") && body.get("enabled") != null) {
            event.setEnabled(Boolean.parseBoolean(body.get("enabled").toString()));
        }
        if (body.containsKey("permittedEditorId") || body.containsKey("permittedEditorIds")) {
            event.setPermittedEditors(permittedEditorsFrom(body));
        }

        if (body.containsKey("alwaysActive") && body.get("alwaysActive") != null) {
            boolean alwaysActive = Boolean.parseBoolean(body.get("alwaysActive").toString());
            event.setAlwaysActive(alwaysActive);
            if (alwaysActive) {
                event.setActiveFrom(null);
                event.setActiveTo(null);
            } else {
                LocalDate from = getDate(body, "activeFrom");
                LocalDate to = getDate(body, "activeTo");
                if (from != null && to != null && to.isBefore(from)) {
                    return ResponseEntity.badRequest().body(Map.of("error", "ØªØ§Ø±ÙŠØ® Ø§Ù„Ø§Ù†ØªÙ‡Ø§Ø¡ Ù„Ø§ ÙŠÙ…ÙƒÙ† Ø£Ù† ÙŠÙƒÙˆÙ† Ù‚Ø¨Ù„ ØªØ§Ø±ÙŠØ® Ø§Ù„Ø¨Ø¯Ø§ÙŠØ©"));
                }
                if (from != null) event.setActiveFrom(from);
                if (to != null) event.setActiveTo(to);
            }
        }

        event = repo.save(event);
        event = repo.findById(event.getId()).orElse(event);
        return ResponseEntity.ok(toMap(event, user));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User user = requireUser(auth);

        CustomAttendanceEvent event = repo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Ø§Ù„Ù…Ù†Ø§Ø³Ø¨Ø© ØºÙŠØ± Ù…ÙˆØ¬ÙˆØ¯Ø©"));

        assertEditPermission(user, event);
        if (canManage(user)) assertFamilyPermission(user, event.getFamilyBase());
        repo.delete(event);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // â”€â”€ field parsing helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

    private String getString(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null) return null;
        String s = v.toString().trim();
        return s.isBlank() ? null : s;
    }

    private boolean getBool(Map<String, Object> body, String key, boolean defaultVal) {
        Object v = body.get(key);
        if (v == null) return defaultVal;
        return Boolean.parseBoolean(v.toString());
    }

    private LocalDate getDate(Map<String, Object> body, String key) {
        Object v = body.get(key);
        if (v == null) return null;
        String s = v.toString().trim();
        if (s.isBlank() || s.equals("null")) return null;
        try { return LocalDate.parse(s); }
        catch (Exception e) { return null; }
    }
}
