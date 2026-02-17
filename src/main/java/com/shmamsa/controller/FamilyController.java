package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
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
            String base = FamilyUtil.mainFamily(u.getDeaconFamily());
            if (base != null && !base.isBlank()) set.add(base);
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

        // Allow servants (KHADIM+) to choose any family; otherwise default to their own.
        boolean canChooseFamily = RoleUtil.isAtLeast(me.getRole(), "KHADIM");

        String target = (canChooseFamily && family != null && !family.isBlank()) ? family : me.getDeaconFamily();

        String base = FamilyUtil.mainFamily(target);

        List<User> members = userRepo.findByDeaconFamilyStartingWithAndRoleIn(base, List.of("MAKHDOM"));

        List<Map<String, Object>> out = new ArrayList<>();
        for (User u : members) {
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

    // Search members by name.
// - If family is provided: search within that family (A/B included via "startingWith" base family).
// - If family is NOT provided: search across all families (KHADIM+ only). If not allowed -> restrict to own family.
    @GetMapping("/search")
    public ResponseEntity<?> search(@RequestParam String name,
                                    @RequestParam(required = false) String family,
                                    Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        String q = name == null ? "" : name.trim();
        if (q.isBlank()) return ResponseEntity.ok(List.of());

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        boolean canChooseFamily = RoleUtil.isAtLeast(me.getRole(), "KHADIM");

        List<User> users;
        if (family != null && !family.isBlank()) {
            // Search inside selected family
            String base = FamilyUtil.mainFamily(family);
            users = userRepo.findByRoleAndDeaconFamilyStartingWithAndFullNameContainingIgnoreCase(
                    "MAKHDOM",
                    base,
                    q
            );
        } else {
            // Search across all families (or restrict to own family if not allowed)
            if (!canChooseFamily) {
                String base = FamilyUtil.mainFamily(me.getDeaconFamily());
                users = userRepo.findByRoleAndDeaconFamilyStartingWithAndFullNameContainingIgnoreCase(
                        "MAKHDOM",
                        base,
                        q
                );
            } else {
                users = userRepo.findByRoleAndFullNameContainingIgnoreCase("MAKHDOM", q);
            }
        }

        // Minimal payload for attendance selection
        List<Map<String, Object>> out = new ArrayList<>();
        for (User u : users) {
            out.add(Map.of(
                    "id", u.getId(),
                    "username", u.getUsername(),
                    "fullName", u.getFullName(),
                    "deaconFamily", u.getDeaconFamily()
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
