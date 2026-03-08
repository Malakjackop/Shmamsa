package com.shmamsa.controller;

import com.shmamsa.dto.AnnouncementUpsertRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.Announcement;
import com.shmamsa.model.EventStatus;
import com.shmamsa.model.User;
import com.shmamsa.repository.AnnouncementRepository;
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

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/announcements")
@RequiredArgsConstructor
public class AnnouncementController {

    private static final String AUDIENCE_EVERYONE = "EVERYONE";
    private static final String AUDIENCE_SERVANTS_ONLY = "SERVANTS_ONLY";

    private final AnnouncementRepository announcementRepo;
    private final UserRepository userRepo;

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        }
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private boolean isAdmin(String role) {
        return RoleUtil.isAtLeast(role, "AMIN_KHEDMA");
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

    private boolean isVisibleToUser(User me, String role, Announcement a) {
        return matchesFamily(me, a.getTargetFamily())
                && matchesAudience(me, role, a.getTargetFamily(), a.getTargetAudience());
    }

    private boolean matchesScopeSelection(Announcement a, String role, String family, String audience) {
        String fam = String.valueOf(family == null ? "" : family).trim();
        String rawAudience = String.valueOf(audience == null ? "" : audience).trim();
        String reqAudience = normalizeAudience(audience);
        String itemAudience = normalizeAudience(a.getTargetAudience());
        String itemFamily = String.valueOf(a.getTargetFamily() == null ? "" : a.getTargetFamily()).trim();

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

        if (!RoleUtil.isAtLeast(role, "KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String myBase = baseFamily(me);
        if (myBase == null || myBase.isBlank()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "No family");
        }

        if (!myBase.equalsIgnoreCase(tf) || "ALL".equalsIgnoreCase(tf)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
        }

        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA") && AUDIENCE_SERVANTS_ONLY.equals(ta)) {
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

    private boolean canFamilyLeaderManage(User me, String role, Announcement a) {
        if (!RoleUtil.isAtLeast(role, "AMIN_OSRA") || isAdmin(role)) return false;
        if (a == null || !isFamilyScopedTarget(a.getTargetFamily())) return false;
        if (!belongsToFamily(me, a.getTargetFamily())) return false;

        User creator = a.getCreatedBy();
        if (creator == null) {
            return true; // legacy records without createdBy
        }

        String creatorRole = scopedRole(creator, a.getTargetFamily());
        return RoleUtil.isAtLeast(creatorRole, "KHADIM")
                && !RoleUtil.isAtLeast(creatorRole, "AMIN_OSRA");
    }

    private boolean canManage(User me, String role, Announcement a) {
        if (isAdmin(role)) return true;
        return canFamilyLeaderManage(me, role, a);
    }

    private boolean isCreator(User me, Announcement a) {
        if (me == null || a == null || a.getCreatedBy() == null) return false;
        String meU = me.getUsername();
        String byU = a.getCreatedBy().getUsername();
        return meU != null && byU != null && byU.equals(meU);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<?> list(
            @RequestParam(required = false) String family,
            @RequestParam(required = false) String audience,
            Authentication auth
    ) {
        User me = requireUser(auth);
        String role = me.getRole();

        List<Announcement> list = announcementRepo.findAllByOrderByCreatedAtDesc();
        List<AnnouncementView> out = new ArrayList<>();

        for (Announcement a : list) {
            EventStatus st = (a.getStatus() == null) ? EventStatus.PENDING : a.getStatus();
            boolean scopeMatch = matchesScopeSelection(a, role, family, audience);
            if (!scopeMatch) continue;

            boolean can = canManage(me, role, a);
            boolean creator = isCreator(me, a);

            if (st == EventStatus.PUBLISHED) {
                if (isVisibleToUser(me, role, a) || can || creator) {
                    out.add(toView(a, st, can, creator));
                }
                continue;
            }

            if (st == EventStatus.PENDING && (can || creator)) {
                out.add(toView(a, st, can, creator));
            }
        }

        return ResponseEntity.ok(out);
    }

    @PostMapping
    public ResponseEntity<?> create(@Valid @RequestBody AnnouncementUpsertRequest req, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        if (!RoleUtil.isAtLeast(role, "KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        validateTarget(me, role, req.getTargetFamily(), req.getTargetAudience());

        Announcement a = Announcement.builder()
                .title(req.getTitle().trim())
                .description(req.getDescription())
                .targetFamily(req.getTargetFamily().trim())
                .targetAudience(normalizeAudience(req.getTargetAudience()))
                .status(EventStatus.PENDING)
                .publishedAt(null)
                .createdBy(me)
                .build();

        announcementRepo.save(a);
        return ResponseEntity.ok(Map.of("id", a.getId()));
    }

    @PutMapping("/{id}")
    @Transactional
    public ResponseEntity<?> update(@PathVariable Long id, @Valid @RequestBody AnnouncementUpsertRequest req, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Announcement a = announcementRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Announcement not found"));

        boolean can = canManage(me, role, a);
        boolean creator = isCreator(me, a);

        if (!(can || creator)) throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");

        validateTarget(me, role, req.getTargetFamily(), req.getTargetAudience());

        a.setTitle(req.getTitle().trim());
        a.setDescription(req.getDescription());
        a.setTargetFamily(req.getTargetFamily().trim());
        a.setTargetAudience(normalizeAudience(req.getTargetAudience()));

        announcementRepo.save(a);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    @PostMapping("/{id}/publish")
    public ResponseEntity<?> publish(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Announcement a = announcementRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Announcement not found"));

        if (!canManage(me, role, a)) throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");

        if (a.getStatus() != EventStatus.PUBLISHED) {
            a.setStatus(EventStatus.PUBLISHED);
            a.setPublishedAt(LocalDateTime.now());
            announcementRepo.save(a);
        }

        return ResponseEntity.ok(Map.of("ok", true));
    }

    @DeleteMapping("/{id}")
    @Transactional
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Announcement a = announcementRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Announcement not found"));

        boolean can = canManage(me, role, a);
        boolean creator = isCreator(me, a);

        if (!(can || creator)) throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");

        announcementRepo.delete(a);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private AnnouncementView toView(Announcement a, EventStatus st, boolean canManage, boolean creator) {
        boolean canEdit = canManage || creator;
        boolean canDelete = canManage || creator;
        boolean canPublish = canManage && st == EventStatus.PENDING;

        return AnnouncementView.builder()
                .id(a.getId())
                .title(a.getTitle())
                .description(a.getDescription())
                .targetFamily(a.getTargetFamily())
                .targetAudience(normalizeAudience(a.getTargetAudience()))
                .status(st.name())
                .publishedAt(a.getPublishedAt())
                .createdAt(a.getCreatedAt())
                .createdByUsername(a.getCreatedBy() != null ? a.getCreatedBy().getUsername() : null)
                .canEdit(canEdit)
                .canDelete(canDelete)
                .canPublish(canPublish)
                .build();
    }

    @Getter
    @Setter
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AnnouncementView {
        private Long id;
        private String title;
        private String description;
        private String targetFamily;
        private String targetAudience;
        private String status;
        private LocalDateTime publishedAt;
        private LocalDateTime createdAt;
        private String createdByUsername;
        private boolean canEdit;
        private boolean canDelete;
        private boolean canPublish;
    }
}
