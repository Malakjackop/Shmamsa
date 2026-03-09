package com.shmamsa.controller;

import com.shmamsa.dto.EventUpsertRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.*;
import com.shmamsa.repository.EventParticipantRepository;
import com.shmamsa.repository.EventRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.util.FamilyUtil;
import jakarta.validation.Valid;
import lombok.*;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.YearMonth;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/events")
@RequiredArgsConstructor
public class EventController {

    private static final String AUDIENCE_EVERYONE = "EVERYONE";
    private static final String AUDIENCE_SERVANTS_ONLY = "SERVANTS_ONLY";

    private final EventRepository eventRepo;
    private final EventParticipantRepository participantRepo;
    private final UserRepository userRepo;

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        }
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private String baseFamily(User u) {
        return FamilyUtil.mainFamily(u == null ? null : u.getDeaconFamily());
    }

    private List<String> allBaseFamilies(User u) {
        if (u == null) return List.of();

        List<String> out = new ArrayList<>();
        List<String> raw = Arrays.asList(
                u.getDeaconFamily(),
                u.getDeaconFamily2(),
                u.getDeaconFamily3(),
                u.getDeaconFamily4()
        );

        for (String item : raw) {
            String base = FamilyUtil.mainFamily(item);
            if (base == null || base.isBlank()) continue;
            if (!out.contains(base)) out.add(base);
        }
        return out;
    }

    private boolean belongsToFamily(User user, String familyBase) {
        String base = String.valueOf(familyBase == null ? "" : familyBase).trim();
        if (base.isBlank() || "ALL".equalsIgnoreCase(base)) return true;
        for (String x : allBaseFamilies(user)) {
            if (base.equalsIgnoreCase(x)) return true;
        }
        return false;
    }

    private boolean isAdmin(String role) {
        return RoleUtil.isAtLeast(role, "AMIN_KHEDMA");
    }

    private String normalizeAudience(String audience) {
        String x = String.valueOf(audience == null ? "" : audience).trim().toUpperCase();
        return AUDIENCE_SERVANTS_ONLY.equals(x) ? AUDIENCE_SERVANTS_ONLY : AUDIENCE_EVERYONE;
    }

    private boolean isServantGlobal(String role) {
        return RoleUtil.isAtLeast(role, "KHADIM");
    }

    private boolean isServantInFamily(User user, String familyBase) {
        if (user == null) return false;
        String base = String.valueOf(familyBase == null ? "" : familyBase).trim();
        if (base.isBlank() || "ALL".equalsIgnoreCase(base)) {
            return isServantGlobal(user.getRole());
        }

        String scopedRole = user.roleForFamilyBase(base);
        if (scopedRole != null && !scopedRole.isBlank()) {
            return RoleUtil.isAtLeast(scopedRole, "KHADIM");
        }

        String myBase = baseFamily(user);
        return myBase != null && myBase.equalsIgnoreCase(base) && isServantGlobal(user.getRole());
    }

    private boolean matchesFamily(User me, String targetFamily) {
        String tf = String.valueOf(targetFamily == null ? "" : targetFamily).trim();
        if (tf.isBlank() || "ALL".equalsIgnoreCase(tf)) return true;
        return belongsToFamily(me, tf);
    }

    private boolean matchesAudience(User me, String role, String targetFamily, String targetAudience) {
        String audience = normalizeAudience(targetAudience);
        if (!AUDIENCE_SERVANTS_ONLY.equals(audience)) return true;

        if ("ALL".equalsIgnoreCase(String.valueOf(targetFamily).trim())) {
            return isServantGlobal(role);
        }
        return isServantInFamily(me, targetFamily);
    }

    private boolean isVisibleToUser(User me, String role, Event e) {
        return matchesFamily(me, e.getTargetFamily())
                && matchesAudience(me, role, e.getTargetFamily(), e.getTargetAudience());
    }

    private boolean matchesScopeSelection(Event e, String role, String family, String audience) {
        String fam = String.valueOf(family == null ? "" : family).trim();
        String rawAudience = String.valueOf(audience == null ? "" : audience).trim();
        String reqAudience = normalizeAudience(audience);
        String itemAudience = normalizeAudience(e.getTargetAudience());
        String itemFamily = String.valueOf(e.getTargetFamily() == null ? "" : e.getTargetFamily()).trim();

        if (fam.isBlank() && rawAudience.isBlank()) {
            return true;
        }

        if (rawAudience.isBlank()) {
            if (fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                return true;
            }
            return "ALL".equalsIgnoreCase(itemFamily) || fam.equalsIgnoreCase(itemFamily);
        }

        if (AUDIENCE_SERVANTS_ONLY.equals(reqAudience)) {
            if (fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                return AUDIENCE_SERVANTS_ONLY.equals(itemAudience) && "ALL".equalsIgnoreCase(itemFamily);
            }
            return AUDIENCE_SERVANTS_ONLY.equals(itemAudience) && fam.equalsIgnoreCase(itemFamily);
        }

        if (fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
            return AUDIENCE_EVERYONE.equals(itemAudience) && "ALL".equalsIgnoreCase(itemFamily);
        }

        return AUDIENCE_EVERYONE.equals(itemAudience)
                && ("ALL".equalsIgnoreCase(itemFamily) || fam.equalsIgnoreCase(itemFamily));
    }

    private void validateTarget(User me, String role, String targetFamily, String targetAudience) {
        String tf = String.valueOf(targetFamily == null ? "" : targetFamily).trim();
        String ta = normalizeAudience(targetAudience);

        if (tf.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "targetFamily is required");

        if (isAdmin(role)) return;

        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String myBase = baseFamily(me);
        if (myBase == null || myBase.isBlank()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "No family");
        }

        if (!myBase.equalsIgnoreCase(tf) || "ALL".equalsIgnoreCase(tf)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
        }

        if (!(AUDIENCE_EVERYONE.equals(ta) || AUDIENCE_SERVANTS_ONLY.equals(ta))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target audience not allowed");
        }
    }

    private boolean isFamilyScopedTarget(String targetFamily) {
        String tf = String.valueOf(targetFamily == null ? "" : targetFamily).trim();
        return !tf.isBlank() && !"ALL".equalsIgnoreCase(tf);
    }

    private String scopedRole(User user, String familyBase) {
        if (user == null) return null;

        String scoped = user.roleForFamilyBase(familyBase);
        if (scoped != null && !scoped.isBlank()) {
            return scoped.trim().toUpperCase();
        }

        return String.valueOf(user.getRole()).trim().toUpperCase();
    }

    private boolean canFamilyLeaderManage(User me, String role, Event e) {
        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA") || isAdmin(role)) return false;
        if (e == null || !isFamilyScopedTarget(e.getTargetFamily())) return false;
        if (!belongsToFamily(me, e.getTargetFamily())) return false;

        User creator = e.getCreatedBy();
        if (creator == null) {
            return true; // legacy records without createdBy
        }

        String creatorRole = scopedRole(creator, e.getTargetFamily());
        return RoleUtil.isAtLeast(creatorRole, "KHADIM")
                && !RoleUtil.isAtLeast(creatorRole, "AMIN_OSRA");
    }

    private boolean canManage(User me, String role, Event e) {
        if (isAdmin(role)) return true;
        return canFamilyLeaderManage(me, role, e);
    }

    private boolean isCreator(User me, Event e) {
        if (me == null || e == null || e.getCreatedBy() == null) return false;
        String meU = me.getUsername();
        String byU = e.getCreatedBy().getUsername();
        return meU != null && byU != null && byU.equals(meU);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<?> list(
            @RequestParam(required = false) String month,
            @RequestParam(required = false) String family,
            @RequestParam(required = false) String audience,
            Authentication auth
    ) {
        User me = requireUser(auth);
        String role = me.getRole();

        YearMonth ym = (month == null || month.isBlank()) ? YearMonth.now() : YearMonth.parse(month.trim());
        LocalDate start = ym.atDay(1);
        LocalDate end = ym.plusMonths(1).atDay(1);

        List<Event> inMonth = eventRepo.findByEventAtGreaterThanEqualAndEventAtLessThan(start, end);
        List<EventView> out = new ArrayList<>();

        for (Event e : inMonth) {
            EventStatus st = (e.getStatus() == null) ? EventStatus.PENDING : e.getStatus();
            boolean scopeMatch = matchesScopeSelection(e, role, family, audience);
            if (!scopeMatch) continue;

            boolean canM = canManage(me, role, e);
            boolean creator = isCreator(me, e);
            boolean visibleToUser = isVisibleToUser(me, role, e);

            boolean publishedVisible = st == EventStatus.PUBLISHED && (visibleToUser || canM || creator);
            boolean pendingVisible = st == EventStatus.PENDING && (canM || creator);

            if (!publishedVisible && !pendingVisible) continue;

            boolean joined = participantRepo.existsByEvent_IdAndUser_Id(e.getId(), me.getId());
            long joinCount = participantRepo.countByEvent_Id(e.getId());

            boolean canEdit = canM || creator;
            boolean canDelete = canM || creator;
            boolean canPublish = canM && st == EventStatus.PENDING;

            out.add(EventView.builder()
                    .id(e.getId())
                    .title(e.getTitle())
                    .description(e.getDescription())
                    .eventAt(e.getEventAt())
                    .targetFamily(e.getTargetFamily())
                    .targetAudience(normalizeAudience(e.getTargetAudience()))
                    .status(st.name())
                    .removeAt(e.getRemoveAt())
                    .publishedAt(e.getPublishedAt())
                    .createdByUsername(e.getCreatedBy() != null ? e.getCreatedBy().getUsername() : null)
                    .joined(joined)
                    .joinCount(joinCount)
                    .canEdit(canEdit)
                    .canDelete(canDelete)
                    .canPublish(canPublish)
                    .canSeeParticipants(canM)
                    .build());
        }

        out.sort(Comparator.comparing(EventView::getEventAt));
        return ResponseEntity.ok(out);
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody EventUpsertRequest req, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        validateTarget(me, role, req.getTargetFamily(), req.getTargetAudience());

        Event e = Event.builder()
                .title(req.getTitle().trim())
                .description(req.getDescription())
                .eventAt(req.getEventAt())
                .targetFamily(req.getTargetFamily().trim())
                .targetAudience(normalizeAudience(req.getTargetAudience()))
                .status(EventStatus.PENDING)
                .removeAt(req.getRemoveAt())
                .createdBy(me)
                .build();

        eventRepo.save(e);
        return ResponseEntity.ok(Map.of("id", e.getId()));
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable Long id, @Valid @RequestBody EventUpsertRequest req, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        boolean canM = canManage(me, role, e);
        boolean creator = isCreator(me, e);

        if (!(canM || creator)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        validateTarget(me, role, req.getTargetFamily(), req.getTargetAudience());

        e.setTitle(req.getTitle().trim());
        e.setDescription(req.getDescription());
        e.setEventAt(req.getEventAt());
        e.setTargetFamily(req.getTargetFamily().trim());
        e.setTargetAudience(normalizeAudience(req.getTargetAudience()));
        e.setRemoveAt(req.getRemoveAt());

        eventRepo.save(e);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @PostMapping("/{id}/publish")
    public ResponseEntity<?> publish(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!canManage(me, role, e)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        EventStatus st = (e.getStatus() == null) ? EventStatus.PENDING : e.getStatus();
        if (st != EventStatus.PUBLISHED) {
            e.setStatus(EventStatus.PUBLISHED);
            e.setPublishedAt(LocalDateTime.now());
            eventRepo.save(e);
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        boolean canM = canManage(me, role, e);
        boolean creator = isCreator(me, e);

        if (!(canM || creator)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        participantRepo.deleteByEvent_Id(e.getId());
        eventRepo.delete(e);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @PostMapping("/{id}/join")
    public ResponseEntity<?> join(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        EventStatus st = (e.getStatus() == null) ? EventStatus.PENDING : e.getStatus();
        if (st != EventStatus.PUBLISHED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Event is not published");
        }

        if (!isVisibleToUser(me, role, e)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        if (!participantRepo.existsByEvent_IdAndUser_Id(id, me.getId())) {
            participantRepo.save(EventParticipant.builder().event(e).user(me).build());
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @DeleteMapping("/{id}/join")
    @Transactional
    public ResponseEntity<?> unjoin(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        participantRepo.deleteByEvent_IdAndUser_Id(id, me.getId());
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @GetMapping("/{id}/participants")
    @Transactional(readOnly = true)
    public ResponseEntity<?> participants(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!canManage(me, role, e)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        List<EventParticipant> parts = participantRepo.findByEvent_Id(id);

        Map<String, List<ParticipantItem>> grouped = new HashMap<>();
        for (EventParticipant ep : parts) {
            User u = ep.getUser();
            if (u == null) continue;

            String fam = FamilyUtil.mainFamily(u.getDeaconFamily());
            if (fam == null) fam = "";

            grouped.computeIfAbsent(fam, k -> new ArrayList<>())
                    .add(ParticipantItem.builder()
                            .fullName(u.getFullName())
                            .deaconFamily(u.getDeaconFamily())
                            .joinedAt(ep.getJoinedAt())
                            .build());
        }

        List<ParticipantsGroup> out = grouped.entrySet().stream()
                .sorted(Map.Entry.comparingByKey())
                .map(en -> {
                    List<ParticipantItem> members = en.getValue();
                    members.sort(Comparator.comparing(ParticipantItem::getDeaconFamily, Comparator.nullsLast(String::compareTo))
                            .thenComparing(ParticipantItem::getFullName, Comparator.nullsLast(String::compareTo)));
                    return ParticipantsGroup.builder().family(en.getKey()).members(members).build();
                })
                .collect(Collectors.toList());

        return ResponseEntity.ok(out);
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EventView {
        private Long id;
        private String title;
        private String description;
        private LocalDate eventAt;
        private String targetFamily;
        private String targetAudience;
        private String status;
        private LocalDate removeAt;
        private LocalDateTime publishedAt;
        private String createdByUsername;
        private boolean joined;
        private long joinCount;
        private boolean canEdit;
        private boolean canDelete;
        private boolean canPublish;
        private boolean canSeeParticipants;
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ParticipantItem {
        private String fullName;
        private String deaconFamily;
        private LocalDateTime joinedAt;
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class ParticipantsGroup {
        private String family;
        private List<ParticipantItem> members;
    }
}