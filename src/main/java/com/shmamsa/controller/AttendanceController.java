package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.QrTokenService;
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
}
