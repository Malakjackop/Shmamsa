package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceStatus;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.QrTokenService;
import com.shmamsa.util.FamilyUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.time.DayOfWeek;
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
        Object dateObj = body.get("date");
        if (typeObj == null || usersObj == null) {
            return ResponseEntity.badRequest().body(Map.of("error", "Missing users/type"));
        }

        AttendanceType type = AttendanceType.valueOf(typeObj.toString());

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> users = (List<Map<String, Object>>) usersObj;

        LocalDate today = LocalDate.now();
        LocalDate selectedDate = today;
        if (dateObj != null && !dateObj.toString().isBlank()) {
            try {
                selectedDate = LocalDate.parse(dateObj.toString());
            } catch (Exception e) {
                return ResponseEntity.badRequest().body(Map.of("error", "Invalid date"));
            }
        }

        // ممنوع المستقبل
        if (selectedDate.isAfter(today)) {
            return ResponseEntity.status(400).body(Map.of("error", "Cannot take attendance in the future"));
        }

        // ممنوع أي يوم قبل Monday بتاع الأسبوع الحالي (إلا أمين الخدمة و الـ dev)
        LocalDate monday = today.with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        boolean canEditPastWeeks = "AMIN_KHEDMA".equalsIgnoreCase(servant.getRole()) || "DEVELOPER".equalsIgnoreCase(servant.getRole());
        if (selectedDate.isBefore(monday) && !canEditPastWeeks) {
            return ResponseEntity.status(400).body(Map.of("error", "Week is closed (cannot edit previous week)"));
        }

        // Enforce day-of-week per type
        DayOfWeek dow = selectedDate.getDayOfWeek();
        if (type == AttendanceType.FAMILY_MEETING && dow != DayOfWeek.THURSDAY) {
            return ResponseEntity.status(400).body(Map.of("error", "Family meeting must be on Thursday"));
        }
        if (type == AttendanceType.FRIDAY_LITURGY && dow != DayOfWeek.FRIDAY) {
            return ResponseEntity.status(400).body(Map.of("error", "Friday liturgy must be on Friday"));
        }
        if (type == AttendanceType.TASBEEHA && dow != DayOfWeek.SATURDAY) {
            return ResponseEntity.status(400).body(Map.of("error", "Tasbeeha must be on Saturday"));
        }
        LocalTime now = LocalTime.now();

        int createdPresent = 0;
        int updatedToPresent = 0;
        int createdAbsent = 0;
        int skipped = 0;

        // Present set (exclude DEVELOPER completely)
        Set<Long> presentIds = new LinkedHashSet<>();

        for (Map<String, Object> u : users) {
            if (u == null || u.get("id") == null) continue;
            Long id;
            try { id = Long.valueOf(u.get("id").toString()); } catch (Exception e) { continue; }
            User target = userRepo.findById(id).orElse(null);
            if (target == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(target.getRole())) continue;
            presentIds.add(id);
        }

        // Determine scope accounts for auto-absence
        List<User> scope;
        if (type == AttendanceType.FAMILY_MEETING) {
            // Thursday: only same family
            String base = null;
            if (!presentIds.isEmpty()) {
                User first = userRepo.findById(presentIds.iterator().next()).orElse(null);
                base = first == null ? null : FamilyUtil.mainFamily(first.getDeaconFamily());
            }
            if (base == null || base.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("error", "Family meeting needs a selected family"));
            }
            scope = userRepo.findByDeaconFamilyStartingWithAndRoleIn(
                    base,
                    List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA")
            );
        } else {
            // Friday/Sat: whole service (all non-dev accounts)
            scope = new ArrayList<>();
            for (User u : userRepo.findAll()) {
                if (u == null) continue;
                if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;
                scope.add(u);
            }
        }


        // 1) Upsert PRESENT for selected
        for (Long id : presentIds) {
            AttendanceRecord existing = attendanceRepo.findFirstByUser_IdAndDateAndType(id, selectedDate, type);
            if (existing != null) {
                // If it was ABSENT, flip to PRESENT
                if (existing.getStatus() == AttendanceStatus.ABSENT) {
                    existing.setStatus(AttendanceStatus.PRESENT);
                    existing.setTime(now);
                    existing.setTakenBy(servant);
                    attendanceRepo.save(existing);
                    updatedToPresent++;
                } else {
                    skipped++;
                }
                continue;
            }

            User target = userRepo.findById(id).orElse(null);
            if (target == null) { skipped++; continue; }
            if ("DEVELOPER".equalsIgnoreCase(target.getRole())) { skipped++; continue; }

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(target);
            r.setDate(selectedDate);
            r.setTime(now);
            r.setType(type);
            r.setStatus(AttendanceStatus.PRESENT);
            r.setTakenBy(servant);
            attendanceRepo.save(r);
            createdPresent++;
        }

        // 2) Auto-create ABSENT for scope users not present
        for (User target : scope) {
            if (target == null || target.getId() == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(target.getRole())) continue;
            if (presentIds.contains(target.getId())) continue;

            AttendanceRecord existing = attendanceRepo.findFirstByUser_IdAndDateAndType(target.getId(), selectedDate, type);
            if (existing != null) {
                // keep as-is (if present, don't overwrite)
                continue;
            }

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(target);
            r.setDate(selectedDate);
            r.setTime(now);
            r.setType(type);
            r.setStatus(AttendanceStatus.ABSENT);
            r.setTakenBy(servant);
            attendanceRepo.save(r);
            createdAbsent++;
        }

        return ResponseEntity.ok(Map.of(
                "ok", true,
                "date", selectedDate.toString(),
                "type", type.name(),
                "presentCreated", createdPresent,
                "presentUpdated", updatedToPresent,
                "absentCreated", createdAbsent,
                "skipped", skipped
        ));

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

    // Start new year: reset attendance for ALL accounts (servants + served)
    // Visible in UI for AMIN_KHEDMA + DEVELOPER only.
    @PostMapping("/start-new-year")
    public ResponseEntity<?> startNewYear(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User actor = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String role = actor.getRole();
        boolean isDev = "DEVELOPER".equals(role);
        boolean isAminKhedma = "AMIN_KHEDMA".equals(role);
        if (!(isDev || isAminKhedma)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        // All real users (exclude DEVELOPER)
        List<User> targets = userRepo.findByRoleIn(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
        List<Long> ids = new ArrayList<>();
        for (User u : targets) {
            if (u == null || u.getId() == null) continue;
            ids.add(u.getId());
        }

        if (ids.isEmpty()) {
            return ResponseEntity.ok(Map.of("ok", true, "users", 0, "deletedRecords", 0));
        }

        // Delete in chunks to avoid DB parameter limits
        int deleted = 0;
        final int CHUNK = 500;
        for (int i = 0; i < ids.size(); i += CHUNK) {
            List<Long> part = ids.subList(i, Math.min(i + CHUNK, ids.size()));
            deleted += attendanceRepo.deleteByUserIds(part);
        }

        return ResponseEntity.ok(Map.of("ok", true, "users", ids.size(), "deletedRecords", deleted));
    }

}
