package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.FamilyUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/family")
@RequiredArgsConstructor
public class FamilyController {

    private final UserRepository userRepo;
    private final AttendanceRepository attendanceRepo;

    @GetMapping("/families")
    public ResponseEntity<?> families(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        Set<String> set = new HashSet<>();
        for (User u : userRepo.findAll()) {
            if (u.getDeaconFamily() == null) continue;

            if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

            String base = FamilyUtil.mainFamily(u.getDeaconFamily());
            if (base == null || base.isBlank()) continue;

            if ("SYSTEM".equalsIgnoreCase(base)) continue;

            set.add(base);
        }

        List<String> out = new ArrayList<>(set);
        out.sort(String::compareTo);
        return ResponseEntity.ok(out);
    }


    @GetMapping("/members")
    public ResponseEntity<?> members(@RequestParam(required = false) String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(me.getRole()) || "DEVELOPER".equals(me.getRole());
        boolean isAminOsra = "AMIN_OSRA".equals(me.getRole());
        boolean isKhadim = "KHADIM".equals(me.getRole());

        // ✅ Special bucket for AMIN_KHEDMA / DEV: "SERVANTS" shows KHADIM + AMIN_OSRA (across all families)
        boolean servantsBucket = isAminKhedmaOrDev && family != null && "SERVANTS".equalsIgnoreCase(family.trim());

        // ✅ Amin khedma/dev can pick a family from the dropdown; others are locked to their own family
        String target = (isAminKhedmaOrDev && family != null && !family.isBlank()) ? family : me.getDeaconFamily();
        String base = servantsBucket ? null : FamilyUtil.mainFamily(target);

        // ✅ Roles visible by permission level
        List<String> rolesToShow;
        if (isAminKhedmaOrDev) {
            rolesToShow = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");
        } else if (isAminOsra) {
            // ✅ Amin Osra can manage/transfer MAKHDOM only (not servants)
            rolesToShow = List.of("MAKHDOM");
        } else if (isKhadim) {
            // ✅ KHADIM:
            // - In "Members of your family" page (no 'family' param): keep old permissions (don't expose AMIN_KHEDMA)
            // - In attendance context (UI sends 'family' param when selecting a family): allow taking attendance/absence
            //   for all roles inside his family including AMIN_KHEDMA.
            boolean attendanceContext = family != null && !family.isBlank();
            rolesToShow = attendanceContext
                    ? List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA")
                    // ✅ In Members page: show served members only
                    : List.of("MAKHDOM");
        } else {
            rolesToShow = List.of("MAKHDOM");
        }

        List<User> members;
        if (servantsBucket) {
            members = userRepo.findByRoleIn(List.of("KHADIM", "AMIN_OSRA"));
        } else {
            members = userRepo.findByDeaconFamilyStartingWithAndRoleIn(base, rolesToShow);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (User u : members) {
            // ✅ Don't show the logged-in account inside the members list
            if (me.getId() != null && me.getId().equals(u.getId())) continue;

            long friday = attendanceRepo.countByUser_IdAndType(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeeha = attendanceRepo.countByUser_IdAndType(u.getId(), AttendanceType.TASBEEHA);
            long meeting = attendanceRepo.countByUser_IdAndType(u.getId(), AttendanceType.FAMILY_MEETING);

            out.add(Map.of(
                    "id", u.getId(),
                    "fullName", u.getFullName(),
                    "role", u.getRole(),
                    "deaconFamily", u.getDeaconFamily(),
                    "fridayLiturgy", friday,
                    "tasbeeha", tasbeeha,
                    "familyMeeting", meeting
            ));
        }

        return ResponseEntity.ok(out);
    }


    @PostMapping("/transfer-members")
    public ResponseEntity<?> transferMembers(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String myRole = me.getRole();
        boolean isDev = "DEVELOPER".equals(myRole);
        boolean isAminKhedma = "AMIN_KHEDMA".equals(myRole);
        boolean isAminOsra = "AMIN_OSRA".equals(myRole);

        if (!(isDev || isAminKhedma || isAminOsra)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        Object idsObj = body.get("memberIds");
        String newFamily = body.get("newFamily") == null ? null : body.get("newFamily").toString();

        if (idsObj == null || newFamily == null || newFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "memberIds and newFamily are required");
        }

        List<Long> ids = new ArrayList<>();
        if (idsObj instanceof List<?> list) {
            for (Object o : list) {
                if (o == null) continue;
                ids.add(Long.valueOf(o.toString()));
            }
        }

        if (ids.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "No members selected");

        String targetBase = FamilyUtil.mainFamily(newFamily);
        if (targetBase == null || targetBase.isBlank() || "SYSTEM".equalsIgnoreCase(targetBase)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid target family");
        }

        String myBase = FamilyUtil.mainFamily(me.getDeaconFamily());

        int updated = 0;
        for (Long id : ids) {
            if (id == null) continue;
            if (me.getId() != null && me.getId().equals(id)) continue; // never move self

            User u = userRepo.findById(id).orElse(null);
            if (u == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

            // ✅ AMIN_OSRA can move only accounts in his family
            if (isAminOsra) {
                String uBase = FamilyUtil.mainFamily(u.getDeaconFamily());
                if (myBase == null || !myBase.equals(uBase)) continue;
                // ✅ AMIN_OSRA can transfer only MAKHDOM (not KHADIM)
                if (!("MAKHDOM".equals(u.getRole()))) continue;
            }

            // ✅ AMIN_KHEDMA / DEV can move MAKHDOM / KHADIM / AMIN_OSRA / AMIN_KHEDMA
            if (isAminKhedma || isDev) {
                if (!("MAKHDOM".equals(u.getRole()) || "KHADIM".equals(u.getRole()) || "AMIN_OSRA".equals(u.getRole()) || "AMIN_KHEDMA".equals(u.getRole()))) {
                    continue;
                }
            }

            u.setDeaconFamily(targetBase);
            userRepo.save(u);
            updated++;
        }

        return ResponseEntity.ok(Map.of("updated", updated));
    }

    @GetMapping("/members/{id}/attendance")
    public ResponseEntity<?> memberAttendance(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        return ResponseEntity.ok(attendanceRepo.findByUser_IdOrderByCreatedAtDesc(id));
    }
}
