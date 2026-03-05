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

    private final EventRepository eventRepo;
    private final EventParticipantRepository participantRepo;
    private final UserRepository userRepo;

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated())
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private String baseFamily(User u) {
        return FamilyUtil.mainFamily(u == null ? null : u.getDeaconFamily());
    }

    // ✅ Developer محسوب أعلى من AMIN_KHEDMA في RoleUtil
    private boolean isAdmin(String role) {
        return RoleUtil.isAtLeast(role, "AMIN_KHEDMA");
    }

    private void validateTargetFamily(User me, String role, String targetFamily) {
        String tf = (targetFamily == null) ? "" : targetFamily.trim();
        if (tf.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "targetFamily is required");

        if (isAdmin(role)) return;

        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String myBase = baseFamily(me);
        if (myBase == null || myBase.isBlank()) throw new ApiException(HttpStatus.FORBIDDEN, "No family");

        if ("ALL".equalsIgnoreCase(tf) || !tf.equals(myBase)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
        }
    }

    private boolean canManage(User me, String role, Event e) {
        if (isAdmin(role)) return true;

        if (RoleUtil.isAtLeast(role, "AMIN_OSRA")) {
            String myBase = baseFamily(me);
            return myBase != null && myBase.equals(e.getTargetFamily());
        }
        return false;
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
            Authentication auth
    ) {
        User me = requireUser(auth);
        String role = me.getRole();

        YearMonth ym = (month == null || month.isBlank()) ? YearMonth.now() : YearMonth.parse(month.trim());
        LocalDate start = ym.atDay(1);
        LocalDate end = ym.plusMonths(1).atDay(1);

        // ✅ ده اللي موجود عندك في EventRepository
        List<Event> inMonth = eventRepo.findByEventAtGreaterThanEqualAndEventAtLessThan(start, end);

        String fam = (family == null) ? null : family.trim();

        List<EventView> out = new ArrayList<>();

        for (Event e : inMonth) {
            EventStatus st = (e.getStatus() == null) ? EventStatus.PENDING : e.getStatus();

            boolean admin = isAdmin(role);

            boolean matchesFamily;
            if (admin) {
                if (fam == null || fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                    matchesFamily = true;
                } else {
                    matchesFamily = fam.equals(e.getTargetFamily()) || "ALL".equalsIgnoreCase(e.getTargetFamily());
                }
            } else {
                String myBase = baseFamily(me);
                matchesFamily = "ALL".equalsIgnoreCase(e.getTargetFamily())
                        || (myBase != null && myBase.equals(e.getTargetFamily()));
            }

            boolean canM = canManage(me, role, e);
            boolean creator = isCreator(me, e);

            boolean publishedVisible = st == EventStatus.PUBLISHED && matchesFamily;
            boolean pendingVisible = st == EventStatus.PENDING && matchesFamily && (canM || creator);

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
                    .status(st.name())
                    .publishAt(e.getPublishAt())
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

        validateTargetFamily(me, role, req.getTargetFamily());

        if (req.getPublishAt() != null && req.getPublishAt().isAfter(req.getEventAt())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "publishAt must be before eventAt");
        }

        Event e = Event.builder()
                .title(req.getTitle().trim())
                .description(req.getDescription())
                .eventAt(req.getEventAt())
                .targetFamily(req.getTargetFamily().trim())
                .status(EventStatus.PENDING)
                .publishAt(req.getPublishAt())
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

        // NOTE:
        // open-in-view is disabled (spring.jpa.open-in-view=false) and createdBy is LAZY.
        // Without a transaction, accessing e.getCreatedBy() may throw LazyInitializationException
        // which becomes a generic 500. Keep this method transactional so creator checks work.
        boolean canM = canManage(me, role, e);
        boolean creator = isCreator(me, e);

        // ✅ خلي التعديل يشتغل للـ creator كمان
        if (!(canM || creator)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        validateTargetFamily(me, role, req.getTargetFamily());

        if (req.getPublishAt() != null && req.getPublishAt().isAfter(req.getEventAt())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "publishAt must be before eventAt");
        }

        e.setTitle(req.getTitle().trim());
        e.setDescription(req.getDescription());
        e.setEventAt(req.getEventAt());
        e.setTargetFamily(req.getTargetFamily().trim());
        e.setPublishAt(req.getPublishAt());

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

    // ✅ مسح الإيفنت: لازم نمسح المشاركين الأول
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

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        EventStatus st = (e.getStatus() == null) ? EventStatus.PENDING : e.getStatus();

        if (st != EventStatus.PUBLISHED) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Event is not published");
        }

        if (!participantRepo.existsByEvent_IdAndUser_Id(id, me.getId())) {
            participantRepo.save(EventParticipant.builder().event(e).user(me).build());
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    // ✅ إلغاء الانضمام: Transaction + delete
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

    @Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
    public static class EventView {
        private Long id;
        private String title;
        private String description;
        private LocalDate eventAt;
        private String targetFamily;
        private String status;
        private LocalDate publishAt;
        private LocalDateTime publishedAt;
        private String createdByUsername;

        private boolean joined;
        private long joinCount;

        private boolean canEdit;
        private boolean canDelete;
        private boolean canPublish;
        private boolean canSeeParticipants;
    }

    @Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ParticipantItem {
        private String fullName;
        private String deaconFamily;
        private LocalDateTime joinedAt;
    }

    @Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
    public static class ParticipantsGroup {
        private String family;
        private List<ParticipantItem> members;
    }
}