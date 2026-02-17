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

        // ✅ Amin khedma/dev can pick a family from the dropdown; others are locked to their own family
        String target = (isAminKhedmaOrDev && family != null && !family.isBlank()) ? family : me.getDeaconFamily();
        String base = FamilyUtil.mainFamily(target);

        // ✅ Roles visible by permission level
        List<String> rolesToShow;
        if (isAminKhedmaOrDev) {
            rolesToShow = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");
        } else if (isAminOsra) {
            rolesToShow = List.of("MAKHDOM", "KHADIM");
        } else {
            rolesToShow = List.of("MAKHDOM");
        }

        List<User> members = userRepo.findByDeaconFamilyStartingWithAndRoleIn(base, rolesToShow);

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

    @GetMapping("/members/{id}/attendance")
    public ResponseEntity<?> memberAttendance(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        return ResponseEntity.ok(attendanceRepo.findByUser_IdOrderByCreatedAtDesc(id));
    }
}
