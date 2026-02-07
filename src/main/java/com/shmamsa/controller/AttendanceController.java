
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

    public record AttendanceSubmitRequest(List<Long> userIds, AttendanceType type) {}

    public record ScanTokenRequest(String token) {}
    public record ScanTokenResponse(Long id, String fullName, String deaconFamily) {}


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

        return ResponseEntity.ok(new ScanTokenResponse(u.getId(), u.getFullName(), u.getDeaconFamily()));
    }

@PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody AttendanceSubmitRequest req) {

        if (req == null || req.userIds() == null || req.userIds().isEmpty() || req.type() == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "userIds and type are required"));
        }

        LocalDate today = LocalDate.now();
        int created = 0;
        int skipped = 0;

        for (Long uid : req.userIds()) {
            if (uid == null) { skipped++; continue; }

            if (attendanceRepo.existsByUser_IdAndDateAndType(uid, today, req.type())) {
                skipped++;
                continue;
            }

            User u = userRepo.findById(uid).orElse(null);
            if (u == null) { skipped++; continue; }

            attendanceRepo.save(AttendanceRecord.builder()
                    .user(u)
                    .date(today)
                    .type(req.type())
                    .createdAt(LocalDateTime.now())
                    .build());
            created++;
        }

        return ResponseEntity.ok(Map.of(
                "message", "Attendance saved",
                "created", created,
                "skipped", skipped,
                "date", today.toString(),
                "type", req.type().name()
        ));
    }
}
