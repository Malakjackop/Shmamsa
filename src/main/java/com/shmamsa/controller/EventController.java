package com.shmamsa.controller;

import com.shmamsa.dto.EventUpsertRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.*;
import com.shmamsa.repository.EventParticipantRepository;
import com.shmamsa.repository.EventRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.ResourceStorageService;
import jakarta.validation.Valid;
import lombok.*;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
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
    private final FamilyAccessService familyAccessService;
    private final ResourceStorageService storage;

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        }
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private List<String> allBaseFamilies(User u) {
        return familyAccessService.servingBasesOf(u);
    }

    private String targetBase(Long familyId, String familyName) {
        String raw = String.valueOf(familyName == null ? "" : familyName).trim();
        if (raw.isBlank() || "ALL".equalsIgnoreCase(raw)) return "ALL";
        return familyAccessService.baseNameForId(familyId, raw);
    }

    private Long targetFamilyId(String familyName) {
        String raw = String.valueOf(familyName == null ? "" : familyName).trim();
        if (raw.isBlank() || "ALL".equalsIgnoreCase(raw)) return null;
        return familyAccessService.familyIdForName(familyAccessService.baseNameForName(raw));
    }

    private record TargetScope(String family, Long familyId, String audience) {}

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

        String scopedRole = familyAccessService.scopedRole(user, base);
        if (scopedRole != null && !scopedRole.isBlank()) {
            return RoleUtil.isAtLeast(scopedRole, "KHADIM");
        }

        return familyAccessService.belongsToBase(user, base) && isServantGlobal(user.getRole());
    }

    private boolean matchesFamily(User me, Long targetFamilyId, String targetFamily) {
        String tf = targetBase(targetFamilyId, targetFamily);
        if (tf.isBlank() || "ALL".equalsIgnoreCase(tf)) return true;
        return belongsToFamily(me, tf);
    }

    private boolean matchesAudience(User me, String role, Long targetFamilyId, String targetFamily, String targetAudience) {
        String audience = normalizeAudience(targetAudience);
        if (!AUDIENCE_SERVANTS_ONLY.equals(audience)) return true;

        if ("ALL".equalsIgnoreCase(targetBase(targetFamilyId, targetFamily))) {
            return isServantGlobal(role);
        }
        return isServantInFamily(me, targetBase(targetFamilyId, targetFamily));
    }

    private boolean isVisibleToUser(User me, String role, Event e) {
        return matchesFamily(me, e.getTargetFamilyId(), e.getTargetFamily())
                && matchesAudience(me, role, e.getTargetFamilyId(), e.getTargetFamily(), e.getTargetAudience());
    }

    private boolean matchesScopeSelection(Event e, String role, String family, String audience) {
        String fam = String.valueOf(family == null ? "" : family).trim();
        String rawAudience = String.valueOf(audience == null ? "" : audience).trim();
        String reqAudience = normalizeAudience(audience);
        String itemAudience = normalizeAudience(e.getTargetAudience());
        String itemFamily = targetBase(e.getTargetFamilyId(), e.getTargetFamily());

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

    private TargetScope validateTarget(User me, String role, Long targetFamilyId, String targetFamily, String targetAudience) {
        String tf = targetBase(targetFamilyId, targetFamily);
        String ta = normalizeAudience(targetAudience);

        if (tf.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "targetFamily is required");

        Long resolvedId = "ALL".equalsIgnoreCase(tf) ? null : targetFamilyId(tf);

        if (isAdmin(role)) return new TargetScope(tf, resolvedId, ta);

        if (!RoleUtil.isAtLeast(role, "KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        if (!familyAccessService.belongsToBase(me, tf)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "No family");
        }
        if ("ALL".equalsIgnoreCase(tf)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
        }

        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA") && AUDIENCE_SERVANTS_ONLY.equals(ta)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target audience not allowed");
        }

        return new TargetScope(tf, resolvedId, ta);
    }

    private void validateEventDates(EventUpsertRequest req) {
        if (req.getEventAt() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "eventAt is required");
        }
        LocalDateTime now = LocalDateTime.now();
        if (req.getEventAt().isBefore(now)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Event time cannot be before now");
        }
        if (req.getRemoveAt() != null && !req.getRemoveAt().isAfter(req.getEventAt())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Remove time must be after event time");
        }
        if (req.getReminderBeforeMinutes() != null && req.getReminderBeforeMinutes() < 0) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Reminder must be zero or more");
        }
    }

    private boolean isFamilyScopedTarget(Long targetFamilyId, String targetFamily) {
        String tf = targetBase(targetFamilyId, targetFamily);
        return !tf.isBlank() && !"ALL".equalsIgnoreCase(tf);
    }

    private String scopedRole(User user, String familyBase) {
        if (user == null) return null;

        String scoped = familyAccessService.scopedRole(user, familyBase);
        if (scoped != null && !scoped.isBlank()) {
            return scoped.trim().toUpperCase();
        }

        return String.valueOf(user.getRole()).trim().toUpperCase();
    }

    private boolean canFamilyLeaderManage(User me, String role, Event e) {
        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA") || isAdmin(role)) return false;
        if (e == null || !isFamilyScopedTarget(e.getTargetFamilyId(), e.getTargetFamily())) return false;
        String targetBase = targetBase(e.getTargetFamilyId(), e.getTargetFamily());
        if (!belongsToFamily(me, targetBase)) return false;

        User creator = e.getCreatedBy();
        if (creator == null) {
            return true; // legacy records without createdBy
        }

        String creatorRole = scopedRole(creator, targetBase);
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

    private boolean canSeeParticipants(User me, String role, Event e) {
        if (e == null) return false;
        if (canManage(me, role, e) || isCreator(me, e)) return true;
        return isVisibleToUser(me, role, e);
    }

    private boolean hasCancelNotice(Event e) {
        return e != null && e.getCancelledAt() != null;
    }

    private boolean isCancelNoticeActive(Event e) {
        if (!hasCancelNotice(e)) return false;
        LocalDateTime until = e.getCancelNoticeUntil();
        return until == null || !until.isBefore(LocalDateTime.now());
    }

    private boolean isReminderActive(Event e) {
        if (e == null || e.getEventAt() == null) return false;
        Integer minutes = e.getReminderBeforeMinutes();
        if (minutes == null || minutes <= 0) return false;

        LocalDateTime now = LocalDateTime.now();
        LocalDateTime trigger = e.getEventAt().minusMinutes(minutes);
        LocalDateTime reminderEnd = e.getEventAt().plusHours(1);
        return !now.isBefore(trigger) && now.isBefore(reminderEnd);
    }

    private int eventPriority(EventView v) {
        if (v == null) return 99;
        if (v.isCancelNoticeActive()) return 0;
        if (v.isReminderActive()) return 1;
        if ("PUBLISHED".equalsIgnoreCase(v.getStatus())) return 2;
        return 3;
    }

    private LocalDateTime defaultCancelNoticeUntil(Event e, LocalDateTime requested) {
        LocalDateTime now = LocalDateTime.now();
        if (requested != null) return requested;
        if (e.getRemoveAt() != null && !e.getRemoveAt().isBefore(now)) return e.getRemoveAt();
        if (e.getEventAt() != null && !e.getEventAt().isBefore(now)) return e.getEventAt().plusDays(1);
        return now.plusDays(3);
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
        LocalDateTime start = ym.atDay(1).atStartOfDay();
        LocalDateTime end = ym.plusMonths(1).atDay(1).atStartOfDay();

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
            boolean hasCancellationNotice = hasCancelNotice(e);
            boolean cancelledVisible = hasCancellationNotice && (canM || creator || (visibleToUser && isCancelNoticeActive(e)));
            boolean pendingVisible = st == EventStatus.PENDING && !hasCancellationNotice && (canM || creator);

            if (!publishedVisible && !cancelledVisible && !pendingVisible) continue;

            boolean joined = participantRepo.existsByEvent_IdAndUser_Id(e.getId(), me.getId());
            long joinCount = participantRepo.countByEvent_Id(e.getId());

            boolean canSeeParts = canSeeParticipants(me, role, e);
            boolean canEdit = canM || creator;
            boolean canDelete = canM || creator;
            boolean canPublish = (canM || creator) && st != EventStatus.PUBLISHED;
            boolean canUnpublish = (canM || creator) && st == EventStatus.PUBLISHED;

            out.add(EventView.builder()
                    .id(e.getId())
                    .title(e.getTitle())
                    .description(e.getDescription())
                    .eventAt(e.getEventAt())
                    .targetFamily(targetBase(e.getTargetFamilyId(), e.getTargetFamily()))
                    .targetAudience(normalizeAudience(e.getTargetAudience()))
                    .status(hasCancellationNotice ? EventStatus.CANCELLED.name() : st.name())
                    .removeAt(e.getRemoveAt())
                    .reminderBeforeMinutes(e.getReminderBeforeMinutes())
                    .reminderActive(isReminderActive(e))
                    .imageUrl(e.getImageStoredName() == null || e.getImageStoredName().isBlank() ? null : "/api/events/" + e.getId() + "/image")
                    .cancelMessage(e.getCancelMessage())
                    .cancelNoticeUntil(e.getCancelNoticeUntil())
                    .cancelledAt(e.getCancelledAt())
                    .cancelNoticeActive(isCancelNoticeActive(e))
                    .publishedAt(e.getPublishedAt())
                    .createdByUsername(e.getCreatedBy() != null ? e.getCreatedBy().getUsername() : null)
                    .joined(joined)
                    .joinCount(joinCount)
                    .canEdit(canEdit)
                    .canDelete(canDelete)
                    .canPublish(canPublish)
                    .canUnpublish(canUnpublish)
                    .canSeeParticipants(canSeeParts)
                    .build());
        }

        out.sort(Comparator
                .comparingInt(this::eventPriority)
                .thenComparing(EventView::getEventAt, Comparator.nullsLast(Comparator.naturalOrder()))
                .thenComparing(EventView::getId, Comparator.nullsLast(Comparator.naturalOrder())));
        return ResponseEntity.ok(out);
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody EventUpsertRequest req, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        if (!RoleUtil.isAtLeast(role, "KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        validateEventDates(req);
        TargetScope scope = validateTarget(me, role, req.getTargetFamilyId(), req.getTargetFamily(), req.getTargetAudience());

        Event e = Event.builder()
                .title(req.getTitle().trim())
                .description(req.getDescription())
                .eventAt(req.getEventAt())
                .targetFamily(scope.family())
                .targetFamilyId(scope.familyId())
                .targetAudience(scope.audience())
                .status(EventStatus.PENDING)
                .removeAt(req.getRemoveAt())
                .reminderBeforeMinutes(req.getReminderBeforeMinutes())
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

        validateEventDates(req);
        TargetScope scope = validateTarget(me, role, req.getTargetFamilyId(), req.getTargetFamily(), req.getTargetAudience());

        e.setTitle(req.getTitle().trim());
        e.setDescription(req.getDescription());
        e.setEventAt(req.getEventAt());
        e.setTargetFamily(scope.family());
        e.setTargetFamilyId(scope.familyId());
        e.setTargetAudience(scope.audience());
        e.setRemoveAt(req.getRemoveAt());
        e.setReminderBeforeMinutes(req.getReminderBeforeMinutes());

        eventRepo.save(e);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @PostMapping("/{id}/publish")
    @Transactional
    public ResponseEntity<?> publish(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!(canManage(me, role, e) || isCreator(me, e))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        EventStatus st = (e.getStatus() == null) ? EventStatus.PENDING : e.getStatus();
        if (st != EventStatus.PUBLISHED) {
            e.setStatus(EventStatus.PUBLISHED);
            e.setPublishedAt(LocalDateTime.now());
            e.setCancelMessage(null);
            e.setCancelNoticeUntil(null);
            e.setCancelledAt(null);
            eventRepo.save(e);
        }
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private String optionalText(Map<String, Object> body, String key) {
        if (body == null || !body.containsKey(key) || body.get(key) == null) return null;
        String value = String.valueOf(body.get(key)).trim();
        return value.isBlank() ? null : value;
    }

    private LocalDateTime parseOptionalDateTime(Object raw) {
        if (raw == null) return null;
        if (raw instanceof LocalDateTime dt) return dt;

        String text = String.valueOf(raw).trim();
        if (text.isBlank() || "null".equalsIgnoreCase(text)) return null;

        try {
            return LocalDateTime.parse(text);
        } catch (DateTimeParseException ignored) {
            // Try the supported fallback formats below.
        }

        try {
            return OffsetDateTime.parse(text).toLocalDateTime();
        } catch (DateTimeParseException ignored) {
            // Try custom fallback formats below.
        }

        List<DateTimeFormatter> formats = List.of(
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss"),
                DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"),
                DateTimeFormatter.ofPattern("HH:mm yyyy-MM-dd"),
                DateTimeFormatter.ofPattern("yyyy-MM-dd")
        );

        for (DateTimeFormatter formatter : formats) {
            try {
                if ("yyyy-MM-dd".equals(formatter.toString())) {
                    // formatter.toString() is not stable, so this branch is intentionally unused.
                }
                if (text.matches("\\d{4}-\\d{2}-\\d{2}$")) {
                    return java.time.LocalDate.parse(text, DateTimeFormatter.ofPattern("yyyy-MM-dd")).atStartOfDay();
                }
                return LocalDateTime.parse(text, formatter);
            } catch (DateTimeParseException ignored) {
                // Continue trying.
            }
        }

        return null;
    }

    @PostMapping("/{id}/pending")
    @Transactional
    public ResponseEntity<?> pending(
            @PathVariable Long id,
            @RequestBody(required = false) Map<String, Object> req,
            Authentication auth
    ) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!(canManage(me, role, e) || isCreator(me, e))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String message = optionalText(req, "message");
        LocalDateTime requestedNoticeUntil = parseOptionalDateTime(req == null ? null : req.get("noticeUntil"));
        LocalDateTime noticeUntil = defaultCancelNoticeUntil(e, requestedNoticeUntil);
        if (noticeUntil == null || noticeUntil.isBefore(LocalDateTime.now())) {
            noticeUntil = LocalDateTime.now().plusDays(3);
        }

        // Do not save CANCELLED in the database. Some existing databases were created
        // before this value existed, so their event status column/check constraint only
        // accepts PENDING and PUBLISHED. We store the row as PENDING and use
        // cancelledAt/cancelNoticeUntil as the real cancellation flag. The list API
        // returns it to the frontend as virtual status CANCELLED.
        e.setStatus(EventStatus.PENDING);
        e.setPublishedAt(null);
        e.setCancelMessage(message == null || message.isBlank() ? null : message);
        e.setCancelNoticeUntil(noticeUntil);
        e.setCancelledAt(LocalDateTime.now());
        eventRepo.save(e);
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

        if (e.getImageStoredName() != null && !e.getImageStoredName().isBlank()) {
            storage.deletePhysical("events", e.getImageStoredName());
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

    @PostMapping(value = "/{id}/image", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @Transactional
    public ResponseEntity<?> uploadImage(
            @PathVariable Long id,
            @RequestParam("file") MultipartFile file,
            Authentication auth
    ) throws Exception {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!(canManage(me, role, e) || isCreator(me, e))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }
        if (file == null || file.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Image is required");
        }
        String contentType = String.valueOf(file.getContentType() == null ? "" : file.getContentType()).toLowerCase(Locale.ROOT);
        if (!contentType.startsWith("image/")) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Only image files are allowed");
        }

        String oldStoredName = e.getImageStoredName();
        var stored = storage.store(file, "events/" + id);

        e.setImageStoredName(stored.storedName);
        e.setImageOriginalName(stored.originalName);
        e.setImageContentType(stored.contentType);
        e.setImageSize(stored.size);
        eventRepo.save(e);

        if (oldStoredName != null && !oldStoredName.isBlank()) {
            storage.deletePhysical("events", oldStoredName);
        }

        return ResponseEntity.ok(Map.of("imageUrl", "/api/events/" + e.getId() + "/image"));
    }

    @GetMapping("/{id}/image")
    @Transactional(readOnly = true)
    public ResponseEntity<?> image(@PathVariable Long id, Authentication auth) throws Exception {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!canManage(me, role, e) && !isCreator(me, e) && !isVisibleToUser(me, role, e)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }
        if (e.getImageStoredName() == null || e.getImageStoredName().isBlank()) {
            throw new ApiException(HttpStatus.NOT_FOUND, "Image not found");
        }

        var stream = storage.download(e.getImageStoredName());
        String contentType = e.getImageContentType() == null || e.getImageContentType().isBlank()
                ? "application/octet-stream"
                : e.getImageContentType();

        return ResponseEntity.ok()
                .header(HttpHeaders.CACHE_CONTROL, "private, max-age=300")
                .contentType(MediaType.parseMediaType(contentType))
                .body(new InputStreamResource(stream));
    }

    @GetMapping("/{id}/participants")
    @Transactional(readOnly = true)
    public ResponseEntity<?> participants(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Event e = eventRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Event not found"));

        if (!canSeeParticipants(me, role, e)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        List<EventParticipant> parts = participantRepo.findByEvent_Id(id);

        Map<String, List<ParticipantItem>> grouped = new HashMap<>();
        for (EventParticipant ep : parts) {
            User u = ep.getUser();
            if (u == null) continue;

            String fam = familyAccessService.baseFamily(u);
            if (fam == null) fam = "";

            grouped.computeIfAbsent(fam, k -> new ArrayList<>())
                    .add(ParticipantItem.builder()
                            .fullName(u.getFullName())
                            .deaconFamily(familyAccessService.primaryFamilyName(u))
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
    @NoArgsConstructor
    @AllArgsConstructor
    public static class UnpublishRequest {
        private String message;
        private LocalDateTime noticeUntil;
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
        private LocalDateTime eventAt;
        private String targetFamily;
        private String targetAudience;
        private String status;
        private LocalDateTime removeAt;
        private Integer reminderBeforeMinutes;
        private boolean reminderActive;
        private String imageUrl;
        private String cancelMessage;
        private LocalDateTime cancelNoticeUntil;
        private LocalDateTime cancelledAt;
        private boolean cancelNoticeActive;
        private LocalDateTime publishedAt;
        private String createdByUsername;
        private boolean joined;
        private long joinCount;
        private boolean canEdit;
        private boolean canDelete;
        private boolean canPublish;
        private boolean canUnpublish;
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
