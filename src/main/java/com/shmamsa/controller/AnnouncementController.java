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

    // ===== Choir buckets (match /api/family/families output) =====
    private static final String KHORS_MARMARKOS = "خورس مارمرقس";
    private static final String KHORS_ATHANASIUS = "خورس البابا اثناسيوس";

    private final AnnouncementRepository announcementRepo;
    private final UserRepository userRepo;

    private User requireUser(Authentication auth) {
        if (auth == null || !auth.isAuthenticated())
            throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private boolean isAdmin(String role) {
        return RoleUtil.isAtLeast(role, "AMIN_KHEDMA");
    }

    private static String normalizeTarget(String raw) {
        if (raw == null) return null;
        String x = raw.trim().replaceAll("\\s+", " ");

        if (x.startsWith("خورس")) {
            String plain = x.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "");
            if (plain.contains("اثناس")) return KHORS_ATHANASIUS;
            if (plain.contains("مرقس")) return KHORS_MARMARKOS;
        }

        if (x.equalsIgnoreCase("خورس الانبا اثناسيوس") || x.equalsIgnoreCase("خورس الأنبا اثناسيوس")) {
            return KHORS_ATHANASIUS;
        }

        return x;
    }

    private static boolean isChoirBucket(String base) {
        if (base == null) return false;
        String x = normalizeTarget(base);
        return KHORS_MARMARKOS.equalsIgnoreCase(x) || KHORS_ATHANASIUS.equalsIgnoreCase(x);
    }

    private static void addKhorsBuckets(Set<String> set, String code) {
        if (set == null) return;
        String c = String.valueOf(code == null ? "" : code).trim().toUpperCase();
        if (c.isBlank() || "NONE".equals(c)) return;

        boolean both = c.contains("BOTH");
        if (both || c.contains("MARMARKOS")) set.add(KHORS_MARMARKOS);
        if (both || c.contains("ATHANASIUS")) set.add(KHORS_ATHANASIUS);
    }

    /** Bases that the user should SEE (family + choir membership). */
    private Set<String> audienceBasesOf(User u) {
        Set<String> set = new LinkedHashSet<>();
        if (u == null) return set;

        String fam = FamilyUtil.mainFamily(u.getDeaconFamily());
        if (fam != null && !fam.isBlank() && !"SYSTEM".equalsIgnoreCase(fam)) set.add(fam);

        addKhorsBuckets(set, u.getAttendKhors());
        addKhorsBuckets(set, u.getKhors());

        return set;
    }

    /** Bases that the user can MANAGE/WRITE to (family + served choir when servingScope indicates). */
    private Set<String> manageBasesOf(User u) {
        Set<String> set = new LinkedHashSet<>();
        if (u == null) return set;

        String fam = FamilyUtil.mainFamily(u.getDeaconFamily());
        if (fam != null && !fam.isBlank() && !"SYSTEM".equalsIgnoreCase(fam)) set.add(fam);

        String scope = String.valueOf(u.getServingScope() == null ? "" : u.getServingScope()).trim().toUpperCase();
        if ("KHORS_ONLY".equals(scope) || "BOTH".equals(scope)) {
            addKhorsBuckets(set, u.getKhors());
        }

        return set;
    }

    private void validateTargetFamily(User me, String role, String targetFamily) {
        String tf = (targetFamily == null) ? "" : targetFamily.trim();
        if (tf.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "targetFamily is required");

        if (isAdmin(role)) return;

        if (!RoleUtil.isAtLeast(role, "KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String tfBase = FamilyUtil.mainFamily(normalizeTarget(tf));
        if (tfBase == null || tfBase.isBlank()) throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
        if ("ALL".equalsIgnoreCase(tfBase)) throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");

        Set<String> allowed = manageBasesOf(me);
        boolean ok = allowed.stream().anyMatch(x -> x.equalsIgnoreCase(tfBase));
        if (!ok) throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
    }

    private boolean canManage(User me, String role, Announcement a) {
        if (isAdmin(role)) return true;

        if (RoleUtil.isAtLeast(role, "KHADIM")) {
            String atBase = FamilyUtil.mainFamily(normalizeTarget(a.getTargetFamily()));
            if (atBase == null || atBase.isBlank() || "ALL".equalsIgnoreCase(atBase)) return false;

            Set<String> allowed = manageBasesOf(me);
            return allowed.stream().anyMatch(x -> x.equalsIgnoreCase(atBase));
        }
        return false;
    }

    private boolean isCreator(User me, Announcement a) {
        if (me == null || a == null || a.getCreatedBy() == null) return false;
        String meU = me.getUsername();
        String byU = a.getCreatedBy().getUsername();
        return meU != null && byU != null && byU.equals(meU);
    }

    private static void addFamilyVariants(List<String> list, String base) {
        if (base == null) return;
        String b = base.trim();
        if (b.isBlank()) return;

        // choir: no variants
        if (isChoirBucket(b)) {
            if (!list.contains(b)) list.add(b);
            return;
        }

        if (!list.contains(b)) list.add(b);
        String a = b + " أ";
        String bb = b + " ب";
        if (!list.contains(a)) list.add(a);
        if (!list.contains(bb)) list.add(bb);
    }

    @GetMapping
    @Transactional(readOnly = true)
    public ResponseEntity<?> list(@RequestParam(required = false) String family, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        String fam = normalizeTarget(family);

        List<Announcement> list;

        if (isAdmin(role)) {
            if (fam == null || fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                list = announcementRepo.findAllByOrderByCreatedAtDesc();
            } else {
                list = announcementRepo.findByTargetFamilyInOrderByCreatedAtDesc(Arrays.asList("ALL", fam));
            }
        } else {
            Set<String> bases = audienceBasesOf(me);
            List<String> targets = new ArrayList<>();
            targets.add("ALL");
            for (String b : bases) addFamilyVariants(targets, b);

            list = announcementRepo.findByTargetFamilyInOrderByCreatedAtDesc(targets);
        }

        Set<String> myAudience = audienceBasesOf(me);
        List<AnnouncementView> out = new ArrayList<>();

        for (Announcement a : list) {
            EventStatus st = (a.getStatus() == null) ? EventStatus.PENDING : a.getStatus();

            boolean matchesScope;
            if (isAdmin(role)) {
                if (fam == null || fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                    matchesScope = true;
                } else {
                    String at = normalizeTarget(a.getTargetFamily());
                    matchesScope = "ALL".equalsIgnoreCase(at) || fam.equalsIgnoreCase(at);
                }
            } else {
                String atBase = FamilyUtil.mainFamily(normalizeTarget(a.getTargetFamily()));
                matchesScope = "ALL".equalsIgnoreCase(atBase)
                        || (atBase != null && myAudience.stream().anyMatch(x -> x.equalsIgnoreCase(atBase)));
            }

            if (!matchesScope) continue;

            boolean can = canManage(me, role, a);
            boolean creator = isCreator(me, a);

            if (st == EventStatus.PUBLISHED) {
                out.add(toView(a, st, can, creator));
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

        validateTargetFamily(me, role, req.getTargetFamily());

        Announcement a = Announcement.builder()
                .title(req.getTitle().trim())
                .description(req.getDescription())
                .targetFamily(req.getTargetFamily().trim())
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

        validateTargetFamily(me, role, req.getTargetFamily());

        a.setTitle(req.getTitle().trim());
        a.setDescription(req.getDescription());
        a.setTargetFamily(req.getTargetFamily().trim());

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
                .status(st.name())
                .publishedAt(a.getPublishedAt())
                .createdAt(a.getCreatedAt())
                .createdByUsername(a.getCreatedBy() != null ? a.getCreatedBy().getUsername() : null)
                .canEdit(canEdit)
                .canDelete(canDelete)
                .canPublish(canPublish)
                .build();
    }

    @Getter @Setter @Builder @NoArgsConstructor @AllArgsConstructor
    public static class AnnouncementView {
        private Long id;
        private String title;
        private String description;
        private String targetFamily;
        private String status; // PENDING/PUBLISHED
        private LocalDateTime publishedAt;
        private LocalDateTime createdAt;
        private String createdByUsername;
        private boolean canEdit;
        private boolean canDelete;
        private boolean canPublish;
    }
}