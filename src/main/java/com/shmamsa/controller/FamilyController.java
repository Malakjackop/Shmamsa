
package com.shmamsa.controller;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/family")
@RequiredArgsConstructor
public class FamilyController {

    private final UserRepository userRepo;
    private final AttendanceRepository attendanceRepo;

    private String authRole(Authentication auth) {
        if (auth == null || auth.getAuthorities() == null) return "MAKHDOM";
        return auth.getAuthorities().stream()
                .findFirst()
                .map(a -> a.getAuthority().replace("ROLE_", ""))
                .orElse("MAKHDOM");
    }

    // For AMIN_KHEDMA/DEVELOPER: list all families (distinct)
    @GetMapping("/families")
    public ResponseEntity<?> families(Authentication auth) {
        String role = authRole(auth);
        if (!RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
        }
        List<String> fams = userRepo.findAll().stream()
                .map(User::getDeaconFamily)
                .filter(Objects::nonNull)
                .distinct()
                .sorted()
                .toList();
        return ResponseEntity.ok(fams);
    }

    public record MemberSummary(Long id, String fullName, String role, String deaconFamily,
                                long fridayLiturgy, long tasbeeha, long familyMeeting) {}

    // Get members for my family (KHADIM/AMIN_OSRA) OR selected family (AMIN_KHEDMA/DEVELOPER)
    @GetMapping("/members")
    public ResponseEntity<?> members(@RequestParam(value = "family", required = false) String family,
                                     Authentication auth) {

        String role = authRole(auth);
        String username = auth != null ? auth.getName() : null;
        User me = (username == null) ? null : userRepo.findByUsername(username).orElse(null);
        if (me == null) {
            return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));
        }

        String targetFamily = family;
        if (!RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            // KHADIM/AMIN_OSRA: forced to own family
            targetFamily = me.getDeaconFamily();
        } else {
            // AMIN_KHEDMA/DEVELOPER: must pick family
            if (targetFamily == null || targetFamily.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "family parameter is required"));
            }
        }

        // Determine visible roles
        List<String> visibleRoles;
        if ("KHADIM".equals(role)) {
            visibleRoles = List.of("MAKHDOM");
        } else if ("AMIN_OSRA".equals(role)) {
            visibleRoles = List.of("MAKHDOM", "KHADIM");
        } else {
            visibleRoles = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA");
        }

        List<User> users = userRepo.findByDeaconFamilyAndRoleIn(targetFamily, visibleRoles);

        // Attendance counts
        List<AttendanceRecord> records = attendanceRepo.findByUser_DeaconFamily(targetFamily);
        Map<Long, Map<AttendanceType, Long>> counts = new HashMap<>();
        for (AttendanceRecord r : records) {
            Long uid = r.getUser().getId();
            counts.putIfAbsent(uid, new EnumMap<>(AttendanceType.class));
            Map<AttendanceType, Long> m = counts.get(uid);
            m.put(r.getType(), m.getOrDefault(r.getType(), 0L) + 1);
        }

        List<MemberSummary> out = users.stream()
                .map(u -> {
                    Map<AttendanceType, Long> m = counts.getOrDefault(u.getId(), Map.of());
                    return new MemberSummary(
                            u.getId(),
                            u.getFullName(),
                            u.getRole(),
                            u.getDeaconFamily(),
                            m.getOrDefault(AttendanceType.FRIDAY_LITURGY, 0L),
                            m.getOrDefault(AttendanceType.TASBEEHA, 0L),
                            m.getOrDefault(AttendanceType.FAMILY_MEETING, 0L)
                    );
                })
                .sorted(Comparator.comparing(MemberSummary::fullName))
                .toList();

        return ResponseEntity.ok(out);
    }

    // Attendance details for a user (must be in visible scope)
    @GetMapping("/members/{id}/attendance")
    public ResponseEntity<?> memberAttendance(@PathVariable("id") Long id,
                                              @RequestParam(value = "family", required = false) String family,
                                              Authentication auth) {
        String role = authRole(auth);
        String username = auth != null ? auth.getName() : null;
        User me = (username == null) ? null : userRepo.findByUsername(username).orElse(null);
        if (me == null) return ResponseEntity.status(401).body(Map.of("error", "Not authenticated"));

        User target = userRepo.findById(id).orElse(null);
        if (target == null) return ResponseEntity.status(404).body(Map.of("error", "User not found"));

        String targetFamily;
        if (!RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            targetFamily = me.getDeaconFamily();
        } else {
            targetFamily = family;
            if (targetFamily == null || targetFamily.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "family parameter is required"));
            }
        }

        if (!Objects.equals(target.getDeaconFamily(), targetFamily)) {
            return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
        }

        // role visibility check
        List<String> visibleRoles;
        if ("KHADIM".equals(role)) visibleRoles = List.of("MAKHDOM");
        else if ("AMIN_OSRA".equals(role)) visibleRoles = List.of("MAKHDOM","KHADIM");
        else visibleRoles = List.of("MAKHDOM","KHADIM","AMIN_OSRA");

        if (!visibleRoles.contains(target.getRole())) {
            return ResponseEntity.status(403).body(Map.of("error", "Forbidden"));
        }

        List<AttendanceRecord> records = attendanceRepo.findByUser_IdOrderByCreatedAtDesc(id);

        // group counts per day for summary (how many attended today by event)
        Map<String, Long> dayCounts = new HashMap<>();
        for (AttendanceRecord r : attendanceRepo.findByUser_DeaconFamily(targetFamily)) {
            String key = r.getDate().toString() + "|" + r.getType().name();
            dayCounts.put(key, dayCounts.getOrDefault(key, 0L) + 1);
        }

        // NOTE: Avoid Map.of(...) here because its type inference can produce an intersection type
        // that doesn't assign cleanly to Map<String, Object> on some Java versions.
        List<Map<String, Object>> out = records.stream().map(r -> {
            String key = r.getDate().toString() + "|" + r.getType().name();
            Map<String, Object> m = new HashMap<>();
            m.put("date", r.getDate().toString());
            m.put("type", r.getType().name());
            m.put("createdAt", r.getCreatedAt().toString());
            m.put("attendedCountThatDay", dayCounts.getOrDefault(key, 0L));
            return m;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(out);
    }
}
