
package com.shmamsa.controller;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.QrTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/attendance")
@RequiredArgsConstructor
public class AttendanceController {

    private final AttendanceRepository attendanceRepo;
    private final UserRepository userRepo;
    private final QrTokenService qrTokenService;
    public record AttendanceUserRef(Long id, String username) {}

    public static class AttendanceSubmitRequest {
        public List<Long> userIds;          // backward compatible (old payload)
        public List<AttendanceUserRef> users; // new payload: [{id, username}]
        public AttendanceType type;
    }

public record ScanTokenRequest(String token) {}
    public record ScanTokenResponse(Long id, String username, String fullName, String deaconFamily) {}


    /**
     * Returns total attendance counts (all time) for the logged-in user.
     * Used by the Dashboard cards.
     */
    @GetMapping("/my-stats")
    public ResponseEntity<?> myStats(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(401).body(Map.of("error", "User not authenticated"));
        }

        String username = authentication.getName();
        User u = userRepo.findByUsername(username).orElse(null);
        if (u == null) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        long friday = attendanceRepo.countByUser_IdAndType(u.getId(), AttendanceType.FRIDAY_LITURGY);
        long tasbeeha = attendanceRepo.countByUser_IdAndType(u.getId(), AttendanceType.TASBEEHA);
        long familyMeeting = attendanceRepo.countByUser_IdAndType(u.getId(), AttendanceType.FAMILY_MEETING);

        return ResponseEntity.ok(Map.of(
                "FRIDAY_LITURGY", friday,
                "TASBEEHA", tasbeeha,
                "FAMILY_MEETING", familyMeeting
        ));
    }

    
    /**
     * Public scan endpoint (no login required):
     * - verifies the QR token signature
     * - ensures the user exists in DB
     * Returns trusted user data for the scanner UI.
     */
    @PostMapping("/scan-token")
    public ResponseEntity<?> scanToken(@RequestBody ScanTokenRequest req) {
        if (req == null || req.token() == null || req.token().isBlank()) {
            return ResponseEntity.badRequest().body(Map.of("error", "token is required"));
        }

        Long userId = qrTokenService.verifyAndExtractUserId(req.token());
        if (userId == null) {
            return ResponseEntity.status(401).body(Map.of("error", "invalid QR token"));
        }

        User u = userRepo.findById(userId).orElse(null);
        if (u == null) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        return ResponseEntity.ok(new ScanTokenResponse(u.getId(), u.getUsername(), u.getFullName(), u.getDeaconFamily()));
    }

@PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody AttendanceSubmitRequest req) {

        if (req == null || req.type == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "type is required"));
        }

        // ✅ Accept either old payload {userIds:[...], type:"..."} OR new payload {users:[{id,username}], type:"..."}
        List<AttendanceUserRef> refs = null;
        if (req.users != null && !req.users.isEmpty()) {
            refs = req.users;
        } else if (req.userIds != null && !req.userIds.isEmpty()) {
            refs = req.userIds.stream().map(id -> new AttendanceUserRef(id, null)).toList();
        } else {
            return ResponseEntity.badRequest().body(Map.of("error", "userIds or users are required"));
        }

        LocalDate today = LocalDate.now();
        int created = 0;
        int skipped = 0;
        int invalid = 0;

        for (AttendanceUserRef ref : refs) {
            if (ref == null || ref.id() == null) { skipped++; continue; }

            Long uid = ref.id();

            if (attendanceRepo.existsByUser_IdAndDateAndType(uid, today, req.type)) {
                skipped++;
                continue;
            }

            User u;
            // ✅ If username is provided, verify (id + username) exists in DB (prevents tampering)
            if (ref.username() != null && !ref.username().isBlank()) {
                u = userRepo.findByIdAndUsername(uid, ref.username().trim()).orElse(null);
                if (u == null) { invalid++; continue; }
            } else {
                u = userRepo.findById(uid).orElse(null);
                if (u == null) { invalid++; continue; }
            }

            attendanceRepo.save(AttendanceRecord.builder()
                    .user(u)
                    .date(today)
                    .type(req.type)
                    .createdAt(LocalDateTime.now())
                    .build());
            created++;
        }

        return ResponseEntity.ok(Map.of(
                "message", "Attendance saved",
                "created", created,
                "skipped", skipped,
                "invalid", invalid,
                "date", today.toString(),
                "type", req.type.name()
        ));
    }

}
