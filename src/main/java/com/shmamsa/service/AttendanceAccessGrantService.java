package com.shmamsa.service;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.*;
import com.shmamsa.repository.AttendanceAccessGrantRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.UserFamilyRoleService;
import lombok.*;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AttendanceAccessGrantService {

    private static final long GRANT_VISIBILITY_HOURS = 48L;

    private final AttendanceAccessGrantRepository grantRepository;
    private final UserRepository userRepository;
    private final FamilyAccessService familyAccessService;
    private final UserFamilyRoleService userFamilyRoleService;

    @Getter
    @Setter
    @NoArgsConstructor
    @AllArgsConstructor
    @Builder
    public static class GrantRequest {
        private Long targetUserId;
        private String grantKind;
        private Long familyId;
        private String familyBase;
        private List<String> allowedTypes;
        private Integer dayOfWeek;
        private String note;
        private LocalDateTime startsAt;
        private LocalDateTime endsAt;
        private Boolean enabled;
    }

    public List<AttendanceAccessGrant> grantsForUser(Long userId) {
        if (userId == null) return List.of();
        return grantRepository.findByTargetUser_IdAndEnabledTrueOrderByStartsAtDesc(userId);
    }

    public List<AttendanceAccessGrant> activeGrantsForUser(Long userId) {
        if (userId == null) return List.of();
        LocalDateTime now = LocalDateTime.now();
        return grantsForUser(userId).stream()
                .filter(g -> g.getStartsAt() != null && g.getEndsAt() != null)
                .filter(g -> !now.isBefore(g.getStartsAt()) && !now.isAfter(g.getEndsAt()))
                .toList();
    }

    public List<AttendanceAccessGrant> visibleGrantsForUser(Long userId) {
        return displayGrantsForUser(userId);
    }

    /**
     * Grants that should be shown to the target user on the attendance page.
     * Current/future grants stay visible so the page can open and show locked types
     * with their configured times.
     * Recently ended grants stay visible for a longer grace period so the member can
     * still understand why one type is closed while another type is currently open.
     */
    public List<AttendanceAccessGrant> displayGrantsForUser(Long userId) {
        if (userId == null) return List.of();
        LocalDateTime now = LocalDateTime.now();
        LocalDateTime earliestEndedAt = now.minusHours(GRANT_VISIBILITY_HOURS);
        return grantsForUser(userId).stream()
                .filter(g -> g.getStartsAt() != null && g.getEndsAt() != null)
                .filter(g -> !g.getEndsAt().isBefore(earliestEndedAt))
                .toList();
    }

    public boolean hasDisplayGrant(Long userId, AttendanceGrantKind kind) {
        return displayGrantsForUser(userId).stream().anyMatch(g -> g.getGrantKind() == kind);
    }

    public boolean hasConfiguredGrant(Long userId, AttendanceGrantKind kind) {
        return grantsForUser(userId).stream().anyMatch(g -> g.getGrantKind() == kind);
    }

    public boolean hasActiveGrant(Long userId, AttendanceGrantKind kind) {
        return activeGrantsForUser(userId).stream().anyMatch(g -> g.getGrantKind() == kind);
    }

    public Set<AttendanceType> activeAllowedTypes(Long userId, AttendanceGrantKind kind) {
        Set<AttendanceType> out = new LinkedHashSet<>();
        for (AttendanceAccessGrant g : activeGrantsForUser(userId)) {
            if (g.getGrantKind() != kind) continue;
            out.addAll(parseTypes(g.getAllowedTypesCsv()));
        }
        return out;
    }

    public Set<AttendanceType> visibleAllowedTypes(Long userId, AttendanceGrantKind kind) {
        Set<AttendanceType> out = new LinkedHashSet<>();
        for (AttendanceAccessGrant g : visibleGrantsForUser(userId)) {
            if (g.getGrantKind() != kind) continue;
            out.addAll(parseTypes(g.getAllowedTypesCsv()));
        }
        return out;
    }

    public boolean hasVisibleGrant(Long userId, AttendanceGrantKind kind) {
        return visibleGrantsForUser(userId).stream().anyMatch(g -> g.getGrantKind() == kind);
    }

    public List<AttendanceAccessGrant> listManageableGrants(User actor) {
        if (actor == null || actor.getId() == null) return List.of();
        validateActorCanManage(actor);
        String role = familyAccessService.normalizeRole(actor.getRole());
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) {
            return grantRepository.findByOrderByCreatedAtDesc();
        }

        List<String> actorBases = familyAccessService.servingBasesOf(actor).stream()
                .map(this::clean)
                .filter(Objects::nonNull)
                .toList();

        if (actorBases.isEmpty()) {
            return grantRepository.findByCreatedBy_IdOrderByCreatedAtDesc(actor.getId());
        }

        return grantRepository.findByOrderByCreatedAtDesc().stream()
                .filter(grant -> grantIsManageableInsideActorScope(actor, actorBases, grant))
                .toList();
    }

    public AttendanceAccessGrant getGrantOrThrow(Long id) {
        return grantRepository.findDetailedById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "GRANT_NOT_FOUND", "Grant not found"));
    }

    @Transactional
    public AttendanceAccessGrant createGrant(User actor, GrantRequest req) {
        validateActorCanManage(actor);
        User target = userRepository.findById(req.getTargetUserId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TARGET_NOT_FOUND", "Target user not found"));
        validateTargetScope(actor, target);

        AttendanceAccessGrant grant = AttendanceAccessGrant.builder()
                .targetUser(target)
                .createdBy(actor)
                .grantKind(parseKind(req.getGrantKind()))
                .familyId(req.getFamilyId())
                .familyBase(clean(req.getFamilyBase()))
                .allowedTypesCsv(toCsv(req.getAllowedTypes()))
                .dayOfWeek(req.getDayOfWeek())
                .note(clean(req.getNote()))
                .startsAt(req.getStartsAt())
                .endsAt(req.getEndsAt())
                .enabled(req.getEnabled() == null || req.getEnabled())
                .build();

        normalizeGrantFamilyScope(grant);
        normalizeCustomEventGrantKind(grant);
        validateGrant(grant);
        return grantRepository.save(grant);
    }

    @Transactional
    public AttendanceAccessGrant updateGrant(User actor, Long id, GrantRequest req) {
        AttendanceAccessGrant grant = getGrantOrThrow(id);
        validateActorCanEdit(actor, grant);

        if (req.getTargetUserId() != null && (grant.getTargetUser() == null || !req.getTargetUserId().equals(grant.getTargetUser().getId()))) {
            User target = userRepository.findById(req.getTargetUserId())
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "TARGET_NOT_FOUND", "Target user not found"));
            validateTargetScope(actor, target);
            grant.setTargetUser(target);
        }
        if (req.getGrantKind() != null && !req.getGrantKind().isBlank()) grant.setGrantKind(parseKind(req.getGrantKind()));
        if (req.getFamilyId() != null) grant.setFamilyId(req.getFamilyId());
        if (req.getFamilyBase() != null) grant.setFamilyBase(clean(req.getFamilyBase()));
        if (req.getAllowedTypes() != null) grant.setAllowedTypesCsv(toCsv(req.getAllowedTypes()));
        if (req.getDayOfWeek() != null) grant.setDayOfWeek(req.getDayOfWeek());
        if (req.getNote() != null) grant.setNote(clean(req.getNote()));
        if (req.getStartsAt() != null) grant.setStartsAt(req.getStartsAt());
        if (req.getEndsAt() != null) grant.setEndsAt(req.getEndsAt());
        if (req.getEnabled() != null) grant.setEnabled(req.getEnabled());

        normalizeGrantFamilyScope(grant);
        normalizeCustomEventGrantKind(grant);
        validateGrant(grant);
        return grantRepository.save(grant);
    }

    @Transactional
    public void deleteGrant(User actor, Long id) {
        AttendanceAccessGrant grant = getGrantOrThrow(id);
        validateActorCanEdit(actor, grant);
        grantRepository.delete(grant);
    }

    private AttendanceGrantKind effectiveGrantKind(AttendanceAccessGrant grant) {
        if (grant == null) return null;
        // Legacy compatibility: previous screens saved MAKHDOM assignments as SELF_CHECKIN.
        // In the current flow, any saved assignment opens delegated attendance-taking.
        if (grant.getGrantKind() == AttendanceGrantKind.SELF_CHECKIN) {
            return AttendanceGrantKind.TAKE_ATTENDANCE;
        }
        return grant.getGrantKind();
    }

    public Map<String, Object> toView(AttendanceAccessGrant grant) {
        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", grant.getId());
        AttendanceGrantKind viewKind = effectiveGrantKind(grant);
        out.put("grantKind", viewKind == null ? null : viewKind.name());
        out.put("familyId", grant.getFamilyId());
        out.put("familyBase", grant.getFamilyBase());
        out.put("allowedTypes", parseTypes(grant.getAllowedTypesCsv()).stream().map(Enum::name).toList());
        out.put("dayOfWeek", grant.getDayOfWeek());
        out.put("note", grant.getNote());
        out.put("startsAt", grant.getStartsAt());
        out.put("endsAt", grant.getEndsAt());
        out.put("enabled", Boolean.TRUE.equals(grant.getEnabled()));
        out.put("createdAt", grant.getCreatedAt());
        out.put("updatedAt", grant.getUpdatedAt());
        LocalDateTime now = LocalDateTime.now();
        boolean active = grant.getStartsAt() != null && grant.getEndsAt() != null
                && !now.isBefore(grant.getStartsAt()) && !now.isAfter(grant.getEndsAt());
        boolean upcoming = grant.getStartsAt() != null && now.isBefore(grant.getStartsAt());
        boolean ended = grant.getEndsAt() != null && now.isAfter(grant.getEndsAt());
        out.put("active", active);
        out.put("upcoming", upcoming);
        out.put("ended", ended);
        out.put("startsInSeconds", grant.getStartsAt() == null ? null : Duration.between(now, grant.getStartsAt()).getSeconds());
        out.put("endsInSeconds", grant.getEndsAt() == null ? null : Duration.between(now, grant.getEndsAt()).getSeconds());
        if (grant.getTargetUser() != null) {
            out.put("targetUserId", grant.getTargetUser().getId());
            out.put("targetUserName", grant.getTargetUser().getFullName());
            out.put("targetUserRole", grant.getTargetUser().getRole());
        }
        if (grant.getCreatedBy() != null) {
            out.put("createdById", grant.getCreatedBy().getId());
            out.put("createdByName", grant.getCreatedBy().getFullName());
        }
        return out;
    }

    private boolean grantIsManageableInsideActorScope(User actor, List<String> actorBases, AttendanceAccessGrant grant) {
        if (grant == null) return false;
        if (grant.getCreatedBy() != null && actor.getId() != null && actor.getId().equals(grant.getCreatedBy().getId())) {
            return true;
        }

        String grantBase = clean(grant.getFamilyBase());
        if (grantBase != null) {
            List<String> grantBases = Arrays.stream(grantBase.split(","))
                    .map(this::clean)
                    .filter(Objects::nonNull)
                    .toList();
            if (!grantBases.isEmpty() && grantBases.stream().anyMatch(actorBases::contains)) {
                return true;
            }
        }

        User target = grant.getTargetUser();
        if (target != null) {
            List<String> targetBases = familyAccessService.servingBasesOf(target).stream()
                    .map(this::clean)
                    .filter(Objects::nonNull)
                    .toList();
            return targetBases.stream().anyMatch(actorBases::contains);
        }
        return false;
    }

    private void validateActorCanManage(User actor) {
        String role = familyAccessService.normalizeRole(actor == null ? null : actor.getRole());
        boolean scopedAmin = hasScopedRole(actor, "AMIN_OSRA") || hasScopedRole(actor, "AMIN_KHEDMA");
        if (!("AMIN_OSRA".equals(role) || "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role) || scopedAmin)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Not allowed to manage attendance access");
        }
    }

    private void validateActorCanEdit(User actor, AttendanceAccessGrant grant) {
        validateActorCanManage(actor);
        String role = familyAccessService.normalizeRole(actor.getRole());
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) return;
        if (grant.getCreatedBy() != null && actor.getId() != null && actor.getId().equals(grant.getCreatedBy().getId())) return;
        List<String> actorBases = familyAccessService.servingBasesOf(actor).stream()
                .map(this::clean)
                .filter(Objects::nonNull)
                .toList();
        if (!actorBases.isEmpty() && grantIsManageableInsideActorScope(actor, actorBases, grant)) return;
        throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "You can only edit your own grants");
    }

    private boolean hasScopedRole(User actor, String neededRole) {
        if (actor == null || actor.getId() == null || neededRole == null || neededRole.isBlank()) return false;
        String needed = neededRole.trim().toUpperCase(Locale.ROOT);
        return userFamilyRoleService.getAssignments(actor).stream()
                .map(UserFamilyAssignmentView::getRole)
                .map(familyAccessService::normalizeRole)
                .anyMatch(needed::equals);
    }

    private void validateTargetScope(User actor, User target) {
        String role = familyAccessService.normalizeRole(actor.getRole());
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) return;

        List<String> actorBases = familyAccessService.servingBasesOf(actor);
        List<String> targetBases = familyAccessService.servingBasesOf(target);
        boolean ok = targetBases.stream().anyMatch(actorBases::contains);
        if (!ok) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Target user is outside your served families");
        }
    }

    private void normalizeGrantFamilyScope(AttendanceAccessGrant grant) {
        if (grant == null) return;
        String familyBase = clean(grant.getFamilyBase());
        Long familyId = grant.getFamilyId();

        if (familyId == null && familyBase != null) {
            familyId = familyAccessService.familyIdForName(familyBase);
        }
        if ((familyBase == null || familyBase.isBlank()) && familyId != null) {
            familyBase = familyAccessService.baseNameForId(familyId, null);
        }

        grant.setFamilyId(familyId);
        grant.setFamilyBase(familyBase);
    }

    // dayOfWeek describes the attendance occasion day (the day being recorded),
    // while startsAt/endsAt describe the time window when recording is allowed.
    // Do not use dayOfWeek to close an otherwise active time window.

    private void validateGrant(AttendanceAccessGrant grant) {
        if (grant.getTargetUser() == null || grant.getTargetUser().getId() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TARGET_REQUIRED", "Target user is required");
        }
        if (grant.getStartsAt() == null || grant.getEndsAt() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "WINDOW_REQUIRED", "Start and end time are required");
        }
        if (!grant.getEndsAt().isAfter(grant.getStartsAt())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_WINDOW", "End time must be after start time");
        }
        Integer day = grant.getDayOfWeek();
        if (day != null && (day < 0 || day > 6)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DAY", "Day of week must be between 0 and 6");
        }
        Set<AttendanceType> types = parseTypes(grant.getAllowedTypesCsv());
        if (types.isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TYPE_REQUIRED", "Select at least one attendance type");
        }
        if (grant.getGrantKind() == AttendanceGrantKind.SELF_CHECKIN && types.contains(AttendanceType.CUSTOM_EVENT)) {
            // A custom event is not a personal/self check-in flow.
            // When the UI saves a custom-event delegation while the audience is still
            // on members, treat it as attendance-taking so MAKHDOM can record
            // presence/absence for the assigned family instead of failing the save.
            grant.setGrantKind(AttendanceGrantKind.TAKE_ATTENDANCE);
        }
    }

    private void normalizeCustomEventGrantKind(AttendanceAccessGrant grant) {
        if (grant == null) return;
        Set<AttendanceType> types = parseTypes(grant.getAllowedTypesCsv());
        if (grant.getGrantKind() == AttendanceGrantKind.SELF_CHECKIN && types.contains(AttendanceType.CUSTOM_EVENT)) {
            grant.setGrantKind(AttendanceGrantKind.TAKE_ATTENDANCE);
        }
    }

    private AttendanceGrantKind parseKind(String raw) {
        try {
            return AttendanceGrantKind.valueOf(String.valueOf(raw).trim().toUpperCase(Locale.ROOT));
        } catch (Exception ex) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_KIND", "Invalid grant kind");
        }
    }

    private Set<AttendanceType> parseTypes(String csv) {
        LinkedHashSet<AttendanceType> out = new LinkedHashSet<>();
        if (csv == null || csv.isBlank()) return out;
        for (String part : csv.split(",")) {
            String p = String.valueOf(part).trim();
            if (p.isBlank()) continue;
            try {
                out.add(AttendanceType.valueOf(p.toUpperCase(Locale.ROOT)));
            } catch (Exception ignored) {
            }
        }
        return out;
    }

    private String toCsv(List<String> raw) {
        if (raw == null) return null;
        return raw.stream()
                .filter(Objects::nonNull)
                .map(x -> x.trim().toUpperCase(Locale.ROOT))
                .filter(x -> !x.isBlank())
                .distinct()
                .collect(Collectors.joining(","));
    }

    private String clean(String value) {
        String x = String.valueOf(value == null ? "" : value).trim();
        return x.isBlank() ? null : x;
    }
}