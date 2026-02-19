package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.service.QrTokenService;
import com.shmamsa.util.FamilyUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.*;

@RestController
@RequestMapping("/api/attendance")
@RequiredArgsConstructor
public class AttendanceController {

    private final AttendanceRepository attendanceRepo;
    private final UserRepository userRepo;
    private final QrTokenService qrTokenService;

    @PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User servant = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        // ✅ Only servants can take attendance
        Set<String> allowed = Set.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "DEVELOPER");
        if (servant.getRole() == null || !allowed.contains(servant.getRole())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        Object typeObj = body.get("type");
        Object usersObj = body.get("users");
        if (typeObj == null || usersObj == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing users/type"));
        }

        AttendanceType type = AttendanceType.valueOf(typeObj.toString());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> users = (List<Map<String, Object>>) usersObj;

        LocalDate today = LocalDate.now();
        LocalTime now = LocalTime.now();

        int created = 0;
        int skipped = 0;


        for (Map<String, Object> u : users) {
            Long id = Long.valueOf(u.get("id").toString());

            if (attendanceRepo.existsByUser_IdAndDateAndType(id, today, type)) {
                skipped++;
                continue;
            }

            User target = userRepo.findById(id).orElse(null);
            if (target == null){
                skipped++;
                continue;
            }

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(target);
            r.setDate(today);
            r.setTime(now);
            r.setType(type);

            r.setTakenBy(servant);

            attendanceRepo.save(r);
            created++;
        }

        return ResponseEntity.ok(Map.of("ok", true, "created", created, "skipped", skipped));

    }

    @PostMapping("/scan-token")
    public ResponseEntity<?> scanToken(@RequestBody Map<String, String> body) {
        String token = body.get("token");
        Long userId = qrTokenService.verifyAndExtractUserId(token);
        if (userId == null) return ResponseEntity.badRequest().body(Map.of("error", "Invalid token"));

        User u = userRepo.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "User not found"));

        return ResponseEntity.ok(Map.of(
                "id", u.getId(),
                "username", u.getUsername(),
                "fullName", u.getFullName(),
                "role", u.getRole(),
                "deaconFamily", ("DEVELOPER".equalsIgnoreCase(u.getRole()) && "SYSTEM".equalsIgnoreCase(u.getDeaconFamily())) ? null : u.getDeaconFamily()
        ));
    }

    @GetMapping("/my-stats")
    public ResponseEntity<?> myStats(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        long f = attendanceRepo.countByUser_IdAndType(me.getId(), AttendanceType.FRIDAY_LITURGY);
        long t = attendanceRepo.countByUser_IdAndType(me.getId(), AttendanceType.TASBEEHA);
        long m = attendanceRepo.countByUser_IdAndType(me.getId(), AttendanceType.FAMILY_MEETING);

        return ResponseEntity.ok(Map.of(
                "FRIDAY_LITURGY", f,
                "TASBEEHA", t,
                "FAMILY_MEETING", m
        ));
    }

    @GetMapping("/history")
    public ResponseEntity<?> history(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));


        List<AttendanceRecord> list = attendanceRepo.findByUser_IdOrderByCreatedAtDesc(me.getId());

        List<Map<String, Object>> out = new ArrayList<>();
        for (AttendanceRecord r : list) {
            out.add(Map.of(
                    "id", r.getId(),
                    "date", r.getDate() == null ? null : r.getDate().toString(),
                    "time", r.getTime() == null ? null : r.getTime().toString(),
                    "type", r.getType() == null ? null : r.getType().name(),
                    "takenBy", r.getTakenBy() == null ? null : r.getTakenBy().getFullName()
            ));
        }
        return ResponseEntity.ok(out);
    }
    // Reset (delete) attendance history for selected users
    // Used by the Family page "Reset Attendance" button.
    @PostMapping("/reset")
    public ResponseEntity<?> reset(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User actor = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        // Parse IDs safely (accept userIds / memberIds / users[{id}])
        Object idsObj = body.get("userIds");
        if (idsObj == null) idsObj = body.get("memberIds");
        if (idsObj == null) idsObj = body.get("users");

        if (!(idsObj instanceof List<?> list)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "userIds is required");
        }

        List<Long> ids = new ArrayList<>();
        for (Object item : list) {
            if (item == null) continue;

            Object v = item;
            if (item instanceof Map<?, ?> m && m.get("id") != null) v = m.get("id");

            try { ids.add(Long.valueOf(v.toString())); } catch (Exception ignored) {}
        }

        if (ids.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "No valid userIds");

        String role = actor.getRole();
        boolean isDev = "DEVELOPER".equals(role);
        boolean isAminKhedma = "AMIN_KHEDMA".equals(role);
        boolean isAminOsra = "AMIN_OSRA".equals(role);
        boolean isKhadim = "KHADIM".equals(role);

        if (!(isDev || isAminKhedma || isAminOsra || isKhadim)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        String myBase = FamilyUtil.mainFamily(actor.getDeaconFamily());

        List<Long> allowed = new ArrayList<>();
        for (Long id : ids) {
            if (id == null) continue;

            User u = userRepo.findById(id).orElse(null);
            if (u == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

            if (isDev || isAminKhedma) {
                allowed.add(id);
                continue;
            }

            // KHADIM / AMIN_OSRA: only reset MAKHDOM inside their family
            String uBase = FamilyUtil.mainFamily(u.getDeaconFamily());
            if (myBase != null && myBase.equals(uBase) && "MAKHDOM".equals(u.getRole())) {
                allowed.add(id);
            }
        }

        if (allowed.isEmpty()) throw new ApiException(HttpStatus.FORBIDDEN, "No allowed users");

        int deleted = attendanceRepo.deleteByUserIds(allowed);
        return ResponseEntity.ok(Map.of("ok", true, "users", allowed.size(), "deletedRecords", deleted));
    }

}
