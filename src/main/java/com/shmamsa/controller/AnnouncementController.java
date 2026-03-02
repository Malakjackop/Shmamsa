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
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/announcements")
@RequiredArgsConstructor
public class AnnouncementController {

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

    private String baseFamily(User u) {
        return FamilyUtil.mainFamily(u == null ? null : u.getDeaconFamily());
    }

    // قواعد التنبيهات:
    // - KHADIM: يكتب لأسرة واحدة فقط (Base) (بدون ALL)
    // - AMIN_OSRA: نفس الكلام
    // - AMIN_KHEDMA/DEVELOPER: يكتب لأي أسرة أو ALL
    private void validateTargetFamily(User me, String role, String targetFamily) {
        String tf = (targetFamily == null) ? "" : targetFamily.trim();
        if (tf.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "targetFamily is required");

        if (isAdmin(role)) return;

        if (!RoleUtil.isAtLeast(role, "KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String myBase = baseFamily(me);
        if (myBase == null || myBase.isBlank()) throw new ApiException(HttpStatus.FORBIDDEN, "No family");

        if ("ALL".equalsIgnoreCase(tf) || !tf.equals(myBase)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Target family not allowed");
        }
    }

    private boolean canManage(User me, String role, Announcement a) {
        if (isAdmin(role)) return true;

        if (RoleUtil.isAtLeast(role, "KHADIM")) {
            String myBase = baseFamily(me);
            return myBase != null && myBase.equals(a.getTargetFamily());
        }
        return false;
    }

    private boolean isCreator(User me, Announcement a) {
        if (me == null || a == null || a.getCreatedBy() == null) return false;
        String meU = me.getUsername();
        String byU = a.getCreatedBy().getUsername();
        return meU != null && byU != null && byU.equals(meU);
    }

    @GetMapping
    public ResponseEntity<?> list(@RequestParam(required = false) String family, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        String fam = (family == null) ? null : family.trim();

        List<Announcement> list;

        if (isAdmin(role)) {
            // family = ALL أو null => هات كل التنبيهات
            if (fam == null || fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                list = announcementRepo.findAllByOrderByCreatedAtDesc();
            } else {
                // أسرة محددة => ALL + الأسرة دي
                list = announcementRepo.findByTargetFamilyInOrderByCreatedAtDesc(List.of("ALL", fam));
            }
        } else {
            // ✅ مستخدم عادي: ALL + أسرته فقط
            String myBase = baseFamily(me);

            // ✅ منع 500: List.of لا تقبل null
            List<String> fams = new ArrayList<>();
            fams.add("ALL");
            if (myBase != null && !myBase.isBlank()) fams.add(myBase);

            list = announcementRepo.findByTargetFamilyInOrderByCreatedAtDesc(fams);
        }

        List<AnnouncementView> out = new ArrayList<>();

        for (Announcement a : list) {

            // ✅ status null-safe (لو قديم في DB)
            EventStatus st = (a.getStatus() == null) ? EventStatus.PENDING : a.getStatus();

            // Scope filter النهائي (لو admin محدد family)
            boolean matchesScope;
            if (isAdmin(role)) {
                if (fam == null || fam.isBlank() || "ALL".equalsIgnoreCase(fam)) {
                    matchesScope = true;
                } else {
                    matchesScope = "ALL".equalsIgnoreCase(a.getTargetFamily()) || fam.equals(a.getTargetFamily());
                }
            } else {
                String myBase = baseFamily(me);
                matchesScope = "ALL".equalsIgnoreCase(a.getTargetFamily())
                        || (myBase != null && myBase.equals(a.getTargetFamily()));
            }
            if (!matchesScope) continue;

            boolean can = canManage(me, role, a);
            boolean creator = isCreator(me, a);

            // Published: يظهر للناس
            if (st == EventStatus.PUBLISHED) {
                out.add(toView(a, st, can, creator));
                continue;
            }

            // ✅ Pending: يظهر للأمين أو لصاحب التنبيه
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
    public ResponseEntity<?> update(@PathVariable Long id, @Valid @RequestBody AnnouncementUpsertRequest req, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Announcement a = announcementRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Announcement not found"));

        EventStatus st = (a.getStatus() == null) ? EventStatus.PENDING : a.getStatus();

        boolean can = canManage(me, role, a);
        boolean creator = isCreator(me, a);

        if (!(can || (creator && st == EventStatus.PENDING))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

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

        EventStatus st = (a.getStatus() == null) ? EventStatus.PENDING : a.getStatus();

        if (st != EventStatus.PUBLISHED) {
            a.setStatus(EventStatus.PUBLISHED);
            a.setPublishedAt(LocalDateTime.now());
            announcementRepo.save(a);
        }

        return ResponseEntity.ok(Map.of("ok", true));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User me = requireUser(auth);
        String role = me.getRole();

        Announcement a = announcementRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Announcement not found"));

        EventStatus st = (a.getStatus() == null) ? EventStatus.PENDING : a.getStatus();

        boolean can = canManage(me, role, a);
        boolean creator = isCreator(me, a);

        if (!(can || (creator && st == EventStatus.PENDING))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        announcementRepo.delete(a);
        return ResponseEntity.ok(Map.of("ok", true));
    }

    private AnnouncementView toView(Announcement a, EventStatus st, boolean canManage, boolean creator) {
        boolean canEdit = canManage || creator;
        boolean canDelete = canManage || creator;
        boolean canPublish = canManage && st == EventStatus.PENDING; // النشر للأمين فقط

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
        private String status;
        private LocalDateTime publishedAt;
        private LocalDateTime createdAt;
        private String createdByUsername;
        private boolean canEdit;
        private boolean canDelete;
        private boolean canPublish;
    }
}