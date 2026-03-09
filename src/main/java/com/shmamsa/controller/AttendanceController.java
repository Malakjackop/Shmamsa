package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceArchive;
import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceStatus;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.AttendanceArchiveRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.QrTokenService;
import com.shmamsa.util.FamilyUtil;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.openhtmltopdf.pdfboxout.PdfRendererBuilder;
import com.ibm.icu.text.ArabicShaping;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import com.openhtmltopdf.bidi.support.ICUBidiReorderer;
import com.openhtmltopdf.bidi.support.ICUBidiSplitter;
import java.util.logging.Level;
import java.util.logging.Logger;

import java.time.LocalDate;
import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.*;

@RestController
@RequestMapping("/api/attendance")
@RequiredArgsConstructor
public class AttendanceController {


    private static volatile boolean OPENHTMLTOPDF_LOGS_SILENCED = false;

    private final AttendanceRepository attendanceRepo;
    private final AttendanceArchiveRepository archiveRepo;
    private final UserRepository userRepo;
    private final QrTokenService qrTokenService;
    private final ObjectMapper objectMapper;

    @PostMapping("/submit")
    public ResponseEntity<?> submit(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User servant = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        Set<String> allowed = Set.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "DEVELOPER");
        if (servant.getRole() == null || !allowed.contains(servant.getRole())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        Object typeObj = body.get("type");
        Object usersObj = body.get("users");
        Object dateObj = body.get("date");
        Object familyObj = body.get("family");
        if (typeObj == null || usersObj == null) {
            return ResponseEntity.badRequest().body(Map.of("خطأ", "برجاء اختيار النوع"));
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
                return ResponseEntity.badRequest().body(Map.of("خطأ", "بيانات خطأ"));
            }
        }

        // ممنوع المستقبل
        if (selectedDate.isAfter(today)) {
            return ResponseEntity.status(400).body(Map.of("خطأ", "مافيش حضور ليوم لسا مجاش"));
        }

        LocalDate monday = today.with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        String roleNorm = servant.getRole() == null ? "" : servant.getRole().trim().toUpperCase().replaceAll("[-\\s]+", "_");
        boolean canOverrideWeekClose = roleNorm.equals("AMIN_OSRA")
                || roleNorm.equals("AMIN_KHEDMA")
                || roleNorm.equals("DEVELOPER")
                || roleNorm.equals("DEV");

        if (selectedDate.isBefore(monday) && !canOverrideWeekClose) {
            return ResponseEntity.status(400).body(Map.of("خطأ", "الاسبوع قفل خلاص يلا من هنا"));
        }

        // Enforce day-of-week per type
        DayOfWeek dow = selectedDate.getDayOfWeek();
        if (type == AttendanceType.FAMILY_MEETING
                && dow != DayOfWeek.THURSDAY
                && dow != DayOfWeek.FRIDAY
                && dow != DayOfWeek.SATURDAY) {
            return ResponseEntity.status(400).body(Map.of("خطأ", "اجتماع الاسره لازم يتاخد يوم الخميس او الجمعه "));
        }
        if ((type == AttendanceType.FRIDAY_LITURGY
                || type == AttendanceType.MARMARKOS_KHORS
                || type == AttendanceType.ATHANASIUS_KHORS)
                && dow != DayOfWeek.FRIDAY) {
            return ResponseEntity.status(400).body(Map.of("خطأ", "القداس لازم يكون يوم الجمعة"));
        }
        if (type == AttendanceType.TASBEEHA && dow != DayOfWeek.SATURDAY) {
            return ResponseEntity.status(400).body(Map.of("خطأ", "التسبحة لازم تكون يوم السبت"));
        }
        LocalTime now = LocalTime.now();


        int createdPresent = 0;
        int updatedToPresent = 0;
        int createdAbsent = 0;
        int skipped = 0;

        Set<Long> presentIds = new LinkedHashSet<>();

        for (Map<String, Object> u : users) {
            if (u == null || u.get("id") == null) continue;
            Long id;
            try {
                id = Long.valueOf(u.get("id").toString());
            } catch (Exception e) {
                continue;
            }
            User target = userRepo.findById(id).orElse(null);
            if (target == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(target.getRole())) continue;
            presentIds.add(id);
        }


        String meetingBase = null;
        if (type == AttendanceType.FAMILY_MEETING) {
            if (familyObj != null && !familyObj.toString().isBlank()) {
                meetingBase = FamilyUtil.mainFamily(familyObj.toString());
            }
            if ((meetingBase == null || meetingBase.isBlank()) && !presentIds.isEmpty()) {
                User first = userRepo.findById(presentIds.iterator().next()).orElse(null);
                meetingBase = first == null ? null : FamilyUtil.mainFamily(first.getDeaconFamily());
            }
        }

        List<User> scope;

        if (type == AttendanceType.FAMILY_MEETING) {
            String base = null;

            if (familyObj != null && !familyObj.toString().isBlank()) {
                base = FamilyUtil.mainFamily(familyObj.toString());
            }

            if ((base == null || base.isBlank()) && !presentIds.isEmpty()) {
                User first = userRepo.findById(presentIds.iterator().next()).orElse(null);
                base = first == null ? null : FamilyUtil.mainFamily(first.getDeaconFamily());
            }

            if (base == null || base.isBlank()) {
                return ResponseEntity.badRequest().body(Map.of("خطأ", "حضور الاسره لازم تختار اسره"));
            }

            scope = userRepo.findByAnyFamilyStartingWithAndRoleIn(
                    base,
                    List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA")
            );
        } else if (type == AttendanceType.MARMARKOS_KHORS || type == AttendanceType.ATHANASIUS_KHORS) {
            String role = servant.getRole() == null ? "" : servant.getRole().trim().toUpperCase(Locale.ROOT);
            boolean isAminOrDev = role.equals("AMIN_KHEDMA") || role.equals("DEVELOPER") || role.equals("DEV");
            if (!isAminOrDev) {
                if (!role.equals("KHADIM")) {
                    throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
                }
                String scopeStr = servant.getServingScope() == null ? "" : servant.getServingScope().trim().toUpperCase(Locale.ROOT);
                if (!("KHORS_ONLY".equals(scopeStr) || "BOTH".equals(scopeStr))) {
                    throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
                }
                String myKhors = servant.getKhors() == null ? "" : servant.getKhors().trim().toUpperCase(Locale.ROOT);
                String needed = (type == AttendanceType.MARMARKOS_KHORS) ? "MARMARKOS" : "ATHANASIUS";
                if (!(myKhors.equals("BOTH") || myKhors.equals(needed))) {
                    throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
                }
            }

            String needed = (type == AttendanceType.MARMARKOS_KHORS) ? "MARMARKOS" : "ATHANASIUS";
            scope = userRepo.findByKhorsAndRoleIn(
                    needed,
                    List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA")
            );
        } else {
            scope = new ArrayList<>();
            for (User u : userRepo.findAll()) {
                if (u == null) continue;
                if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;
                scope.add(u);
            }
        }


        for (Long id : presentIds) {
            AttendanceRecord existing;
            if (type == AttendanceType.FAMILY_MEETING) {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(id, selectedDate, type, meetingBase);
            } else {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(id, selectedDate, type);
            }
            if (existing != null) {
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
            if (target == null) {
                skipped++;
                continue;
            }
            if ("DEVELOPER".equalsIgnoreCase(target.getRole())) {
                skipped++;
                continue;
            }

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(target);
            r.setDate(selectedDate);
            r.setTime(now);
            r.setType(type);
            if (type == AttendanceType.FAMILY_MEETING) {
                r.setFamilyBase(meetingBase);
            }
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

            AttendanceRecord existing;
            if (type == AttendanceType.FAMILY_MEETING) {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(target.getId(), selectedDate, type, meetingBase);
            } else {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(target.getId(), selectedDate, type);
            }
            if (existing != null) {
                // keep as-is (if present, don't overwrite)
                continue;
            }

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(target);
            r.setDate(selectedDate);
            r.setTime(now);
            r.setType(type);
            if (type == AttendanceType.FAMILY_MEETING) {
                r.setFamilyBase(meetingBase);
            }
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

        AttendanceType selectedType = null;
        String typeRaw = body.get("type");
        if (typeRaw != null && !typeRaw.isBlank()) {
            try {
                selectedType = AttendanceType.valueOf(typeRaw.trim());
            } catch (Exception ignored) {
                selectedType = null;
            }
        }

        LocalDate selectedDate = null;
        String dateRaw = body.get("date");
        if (dateRaw != null && !dateRaw.isBlank()) {
            try {
                selectedDate = LocalDate.parse(dateRaw.trim());
            } catch (Exception ignored) {
                selectedDate = null;
            }
        }

        String familyBase = null;
        String familyRaw = body.get("family");
        if (familyRaw != null && !familyRaw.isBlank()) {
            familyBase = FamilyUtil.mainFamily(familyRaw.trim());
        }

        AttendanceRecord existing = null;
        if (selectedType != null && selectedDate != null) {
            if (selectedType == AttendanceType.FAMILY_MEETING && familyBase != null && !familyBase.isBlank()) {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(
                        u.getId(), selectedDate, selectedType, familyBase
                );
            } else if (selectedType != AttendanceType.FAMILY_MEETING) {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(
                        u.getId(), selectedDate, selectedType
                );
            }
        }

        boolean alreadyRecorded = existing != null;
        boolean alreadyPresent = existing != null && (existing.getStatus() == null || existing.getStatus() == AttendanceStatus.PRESENT);
        String existingStatus = existing == null || existing.getStatus() == null ? null : existing.getStatus().name();

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("id", u.getId());
        out.put("username", u.getUsername());
        out.put("fullName", u.getFullName());
        out.put("role", u.getRole());
        out.put("deaconFamily", ("DEVELOPER".equalsIgnoreCase(u.getRole()) && "SYSTEM".equalsIgnoreCase(u.getDeaconFamily())) ? null : u.getDeaconFamily());
        out.put("alreadyRecorded", alreadyRecorded);
        out.put("alreadyPresent", alreadyPresent);
        out.put("existingStatus", existingStatus);
        return ResponseEntity.ok(out);
    }

    @GetMapping("/my-stats")
    public ResponseEntity<?> myStats(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        long f = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.FRIDAY_LITURGY);
        long mk = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.MARMARKOS_KHORS);
        long ak = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.ATHANASIUS_KHORS);
        long t = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.TASBEEHA);
        long m = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.FAMILY_MEETING);

        return ResponseEntity.ok(Map.of(
                "FRIDAY_LITURGY", f,
                "MARMARKOS_KHORS", mk,
                "ATHANASIUS_KHORS", ak,
                "TASBEEHA", t,
                "FAMILY_MEETING", m
        ));
    }


    @GetMapping("/my-stats-v2")
    public ResponseEntity<?> myStatsV2(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        long fPresent = attendanceRepo.countPresentByUserAndTypeActive(me.getId(), AttendanceType.FRIDAY_LITURGY);
        long mkPresent = attendanceRepo.countPresentByUserAndTypeActive(me.getId(), AttendanceType.MARMARKOS_KHORS);
        long akPresent = attendanceRepo.countPresentByUserAndTypeActive(me.getId(), AttendanceType.ATHANASIUS_KHORS);
        long tPresent = attendanceRepo.countPresentByUserAndTypeActive(me.getId(), AttendanceType.TASBEEHA);
        long mPresent = attendanceRepo.countPresentByUserAndTypeActive(me.getId(), AttendanceType.FAMILY_MEETING);

        long fTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.FRIDAY_LITURGY);
        long mkTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.MARMARKOS_KHORS);
        long akTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.ATHANASIUS_KHORS);
        long tTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.TASBEEHA);
        long mTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(me.getId(), AttendanceType.FAMILY_MEETING);

        // FAMILY_MEETING broken down by familyBase (multi-family)
        Map<String, Long> familyMeetingByFamily = new LinkedHashMap<>();
        Map<String, Long> familyMeetingTotalByFamily = new LinkedHashMap<>();
        for (AttendanceRecord r : attendanceRepo.findByUser_IdAndTypeAndArchivedFalseOrderByCreatedAtDesc(me.getId(), AttendanceType.FAMILY_MEETING)) {
            String fb = r.getFamilyBase() == null ? "" : r.getFamilyBase().trim();
            if (fb.isBlank()) continue;
            familyMeetingTotalByFamily.put(fb, familyMeetingTotalByFamily.getOrDefault(fb, 0L) + 1L);
            // count only PRESENT (or null treated as present for legacy)
            if (r.getStatus() != null && r.getStatus() == AttendanceStatus.ABSENT) continue;
            familyMeetingByFamily.put(fb, familyMeetingByFamily.getOrDefault(fb, 0L) + 1L);
        }

        return ResponseEntity.ok(Map.ofEntries(
                Map.entry("FRIDAY_LITURGY", fPresent),
                Map.entry("MARMARKOS_KHORS", mkPresent),
                Map.entry("ATHANASIUS_KHORS", akPresent),
                Map.entry("TASBEEHA", tPresent),
                Map.entry("FAMILY_MEETING", mPresent),
                Map.entry("FRIDAY_LITURGY_TOTAL", fTotal),
                Map.entry("MARMARKOS_KHORS_TOTAL", mkTotal),
                Map.entry("ATHANASIUS_KHORS_TOTAL", akTotal),
                Map.entry("TASBEEHA_TOTAL", tTotal),
                Map.entry("FAMILY_MEETING_TOTAL", mTotal),
                Map.entry("FAMILY_MEETING_BY_FAMILY", familyMeetingByFamily),
                Map.entry("FAMILY_MEETING_TOTAL_BY_FAMILY", familyMeetingTotalByFamily)
        ));
    }


    @GetMapping("/history")
    public ResponseEntity<?> history(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));


        List<AttendanceRecord> list = attendanceRepo.findByUser_IdAndArchivedFalseOrderByCreatedAtDesc(me.getId());

        List<Map<String, Object>> out = new ArrayList<>();
        for (AttendanceRecord r : list) {
            out.add(Map.of(
                    "id", r.getId(),
                    "date", r.getDate() == null ? null : r.getDate().toString(),
                    "time", r.getTime() == null ? null : r.getTime().toString(),
                    "type", r.getType() == null ? null : r.getType().name(),
                    "takenBy", r.getTakenBy() == null ? null : r.getTakenBy().getFullName(),
                    "familyBase", r.getFamilyBase()
            ));
        }
        return ResponseEntity.ok(out);
    }


    // =========================
    // Daily review (حضور اليوم)
    // =========================

    @GetMapping("/daily")
    public ResponseEntity<?> daily(@RequestParam(required = false) String date,
                                   @RequestParam AttendanceType type,
                                   @RequestParam(required = false) String family,
                                   Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User servant = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        assertServantCanEditAttendance(servant);

        LocalDate today = LocalDate.now();
        LocalDate selectedDate = today;
        if (date != null && !date.isBlank()) {
            try {
                selectedDate = LocalDate.parse(date.trim());
            } catch (Exception e) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid date");
            }
        }

        if (selectedDate.isAfter(today)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Cannot view attendance in the future");
        }

        enforceWeekClose(servant, selectedDate);
        enforceDayOfWeek(type, selectedDate);

        // Scope = selected family / choir (or all)
        ScopeResult scope = resolveScopeUsers(servant, type, family);

        List<Long> ids = scope.users.stream()
                .filter(u -> u != null && u.getId() != null)
                .map(User::getId)
                .collect(Collectors.toList());

        List<AttendanceRecord> records;
        if (type == AttendanceType.FAMILY_MEETING) {
            records = ids.isEmpty()
                    ? List.of()
                    : attendanceRepo.findByDateAndTypeAndFamilyBaseAndArchivedFalseAndUser_IdIn(selectedDate, type, scope.familyBase, ids);
        } else {
            records = ids.isEmpty()
                    ? List.of()
                    : attendanceRepo.findByDateAndTypeAndArchivedFalseAndUser_IdIn(selectedDate, type, ids);
        }

        Map<Long, AttendanceRecord> byUser = new HashMap<>();
        for (AttendanceRecord r : records) {
            if (r == null || r.getUser() == null || r.getUser().getId() == null) continue;
            byUser.put(r.getUser().getId(), r);
        }

        List<Map<String, Object>> present = new ArrayList<>();
        List<Map<String, Object>> absent = new ArrayList<>();

        for (User u : scope.users) {
            if (u == null || u.getId() == null) continue;
            AttendanceRecord r = byUser.get(u.getId());
            AttendanceStatus st = (r == null || r.getStatus() == null) ? AttendanceStatus.ABSENT : r.getStatus();
            // Legacy: null treated as present in old DB, but current model defaults to PRESENT.
            if (r != null && r.getStatus() == null) st = AttendanceStatus.PRESENT;

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", u.getId());
            row.put("fullName", u.getFullName());
            row.put("role", u.getRole());
            row.put("deaconFamily", u.getDeaconFamily());
            row.put("status", st.name());
            if (st == AttendanceStatus.PRESENT) present.add(row);
            else absent.add(row);
        }

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("ok", true);
        out.put("date", selectedDate.toString());
        out.put("type", type.name());
        out.put("family", family);
        out.put("familyBase", scope.familyBase);
        out.put("total", scope.users.size());
        out.put("presentCount", present.size());
        out.put("absentCount", absent.size());
        out.put("recordsCount", records.size());
        out.put("present", present);
        out.put("absent", absent);
        return ResponseEntity.ok(out);
    }


    @PostMapping("/mark-absent")
    public ResponseEntity<?> markAbsent(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User servant = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        assertServantCanEditAttendance(servant);

        if (body == null) throw new ApiException(HttpStatus.BAD_REQUEST, "Missing body");

        Object userIdObj = body.get("userId");
        Object dateObj = body.get("date");
        Object typeObj = body.get("type");
        Object familyObj = body.get("family");

        if (userIdObj == null || typeObj == null || dateObj == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "userId/date/type are required");
        }

        Long userId;
        try {
            userId = Long.valueOf(userIdObj.toString());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid userId");
        }

        AttendanceType type;
        try {
            type = AttendanceType.valueOf(typeObj.toString());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid type");
        }

        LocalDate selectedDate;
        try {
            selectedDate = LocalDate.parse(dateObj.toString());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid date");
        }

        LocalDate today = LocalDate.now();
        if (selectedDate.isAfter(today)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Cannot edit attendance in the future");
        }

        enforceWeekClose(servant, selectedDate);
        enforceDayOfWeek(type, selectedDate);

        String family = familyObj == null ? null : familyObj.toString();
        ScopeResult scope = resolveScopeUsers(servant, type, family);

        boolean inScope = scope.users.stream().anyMatch(u -> u != null && u.getId() != null && u.getId().equals(userId));
        if (!inScope) {
            throw new ApiException(HttpStatus.FORBIDDEN, "User not in scope");
        }

        AttendanceRecord existing;
        if (type == AttendanceType.FAMILY_MEETING) {
            existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(userId, selectedDate, type, scope.familyBase);
        } else {
            existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(userId, selectedDate, type);
        }

        LocalTime now = LocalTime.now();
        if (existing != null) {
            existing.setStatus(AttendanceStatus.ABSENT);
            existing.setTime(now);
            existing.setTakenBy(servant);
            attendanceRepo.save(existing);
            return ResponseEntity.ok(Map.of(
                    "ok", true,
                    "id", existing.getId(),
                    "userId", userId,
                    "date", selectedDate.toString(),
                    "type", type.name(),
                    "status", "ABSENT"
            ));
        }

        User target = userRepo.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "User not found"));

        AttendanceRecord r = new AttendanceRecord();
        r.setUser(target);
        r.setDate(selectedDate);
        r.setTime(now);
        r.setType(type);
        if (type == AttendanceType.FAMILY_MEETING) {
            r.setFamilyBase(scope.familyBase);
        }
        r.setStatus(AttendanceStatus.ABSENT);
        r.setTakenBy(servant);
        attendanceRepo.save(r);

        return ResponseEntity.ok(Map.of(
                "ok", true,
                "id", r.getId(),
                "userId", userId,
                "date", selectedDate.toString(),
                "type", type.name(),
                "status", "ABSENT"
        ));
    }


    // ===== helpers =====

    private void assertServantCanEditAttendance(User servant) {
        if (servant == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        Set<String> allowed = Set.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "DEVELOPER", "DEV");
        String role = servant.getRole() == null ? "" : servant.getRole().trim().toUpperCase(Locale.ROOT);
        if (!allowed.contains(role)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }
    }

    private void enforceWeekClose(User servant, LocalDate selectedDate) {
        if (selectedDate == null) return;

        LocalDate today = LocalDate.now();
        LocalDate monday = today.with(java.time.temporal.TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));

        String roleNorm = servant.getRole() == null ? "" : servant.getRole().trim().toUpperCase(Locale.ROOT).replaceAll("[-\\s]+", "_");
        boolean canOverrideWeekClose = roleNorm.equals("AMIN_OSRA")
                || roleNorm.equals("AMIN_KHEDMA")
                || roleNorm.equals("DEVELOPER")
                || roleNorm.equals("DEV");

        if (selectedDate.isBefore(monday) && !canOverrideWeekClose) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Week is closed (cannot edit previous week)");
        }
    }

    private void enforceDayOfWeek(AttendanceType type, LocalDate selectedDate) {
        if (type == null || selectedDate == null) return;
        DayOfWeek dow = selectedDate.getDayOfWeek();
        if (type == AttendanceType.FAMILY_MEETING
                && dow != DayOfWeek.THURSDAY
                && dow != DayOfWeek.FRIDAY
                && dow != DayOfWeek.SATURDAY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Family meeting must be on Thursday, Friday, or Saturday");
        }
        if ((type == AttendanceType.FRIDAY_LITURGY
                || type == AttendanceType.MARMARKOS_KHORS
                || type == AttendanceType.ATHANASIUS_KHORS)
                && dow != DayOfWeek.FRIDAY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "This type must be on Friday");
        }
        if (type == AttendanceType.TASBEEHA && dow != DayOfWeek.SATURDAY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Tasbeeha must be on Saturday");
        }
    }

    private boolean isChoirLabel(String family) {
        if (family == null) return false;
        String x = family.trim();
        return x.equals("خورس مارمرقس") || x.equals("خورس البابا اثناسيوس");
    }

    private String choirKeyFromLabel(String family) {
        String x = family == null ? "" : family.trim();
        if (x.equals("خورس مارمرقس")) return "MARMARKOS";
        if (x.equals("خورس البابا اثناسيوس")) return "ATHANASIUS";
        return "";
    }

    private void assertChoirAuthorization(User servant, AttendanceType type) {
        String role = servant.getRole() == null ? "" : servant.getRole().trim().toUpperCase(Locale.ROOT);
        boolean isAminOrDev = role.equals("AMIN_KHEDMA") || role.equals("DEVELOPER") || role.equals("DEV");
        if (isAminOrDev) return;

        if (!role.equals("KHADIM")) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String scopeStr = servant.getServingScope() == null ? "" : servant.getServingScope().trim().toUpperCase(Locale.ROOT);
        if (!("KHORS_ONLY".equals(scopeStr) || "BOTH".equals(scopeStr))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }

        String myKhors = servant.getKhors() == null ? "" : servant.getKhors().trim().toUpperCase(Locale.ROOT);
        String needed = (type == AttendanceType.MARMARKOS_KHORS) ? "MARMARKOS" : "ATHANASIUS";
        if (!(myKhors.equals("BOTH") || myKhors.equals(needed))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Not allowed");
        }
    }

    private static class ScopeResult {
        final List<User> users;
        final String familyBase;

        ScopeResult(List<User> users, String familyBase) {
            this.users = users == null ? List.of() : users;
            this.familyBase = familyBase;
        }
    }

    private ScopeResult resolveScopeUsers(User servant, AttendanceType type, String family) {
        List<String> roles = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");

        if (type == AttendanceType.MARMARKOS_KHORS || type == AttendanceType.ATHANASIUS_KHORS) {
            assertChoirAuthorization(servant, type);
            String needed = (type == AttendanceType.MARMARKOS_KHORS) ? "MARMARKOS" : "ATHANASIUS";
            return new ScopeResult(userRepo.findByKhorsAndRoleIn(needed, roles), null);
        }

        if (type == AttendanceType.FAMILY_MEETING) {
            String base = (family == null || family.isBlank()) ? null : FamilyUtil.mainFamily(family);
            if (base == null || base.isBlank()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Family meeting needs a selected family");
            }
            return new ScopeResult(userRepo.findByAnyFamilyStartingWithAndRoleIn(base, roles), base);
        }

        // Friday / Saturday types: allow filtering by selected family or choir label
        if (family != null && !family.trim().isBlank()) {
            if (isChoirLabel(family)) {
                String needed = choirKeyFromLabel(family);
                return new ScopeResult(userRepo.findByKhorsAndRoleIn(needed, roles), null);
            }
            String base = FamilyUtil.mainFamily(family);
            if (base != null && !base.isBlank()) {
                return new ScopeResult(userRepo.findByAnyFamilyStartingWithAndRoleIn(base, roles), base);
            }
        }

        // All service
        return new ScopeResult(userRepo.findByRoleIn(roles), null);
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

            try {
                ids.add(Long.valueOf(v.toString()));
            } catch (Exception ignored) {
            }
        }

        if (ids.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "No valid userIds");

        String role = actor.getRole();
        boolean isDev = "DEVELOPER".equalsIgnoreCase(role);
        boolean isAminKhedma = "AMIN_KHEDMA".equalsIgnoreCase(role);
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

    // Start new year: ARCHIVE attendance for ALL accounts (servants + served)
    // Visible in UI for AMIN_KHEDMA + DEVELOPER only.
    @PostMapping("/start-new-year")
    public ResponseEntity<?> startNewYear(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User actor = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String role = actor.getRole();
        boolean isDev = "DEVELOPER".equalsIgnoreCase(role);
        boolean isAminKhedma = "AMIN_KHEDMA".equalsIgnoreCase(role);
        if (!(isDev || isAminKhedma)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        String archiveName = body == null ? null : Objects.toString(body.get("name"), null);
        if (archiveName == null || archiveName.trim().isEmpty()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Archive name is required");
        }
        archiveName = archiveName.trim();
        if (archiveName.length() > 120) archiveName = archiveName.substring(0, 120);

        // All real users (exclude DEVELOPER)
        List<User> targets = userRepo.findByRoleIn(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
        List<Long> ids = new ArrayList<>();
        for (User u : targets) {
            if (u == null || u.getId() == null) continue;
            ids.add(u.getId());
        }

        // Load all ACTIVE (غير مؤرشف) attendance records for all users
        List<AttendanceRecord> records = ids.isEmpty() ? List.of() : attendanceRepo.findByUser_IdInAndArchivedFalse(ids);

        // Build snapshots (users + records) as JSON
        List<Map<String, Object>> usersSnap = new ArrayList<>();
        for (User u : targets) {
            if (u == null) continue;
            usersSnap.add(new LinkedHashMap<>(Map.of(
                    "id", u.getId(),
                    "fullName", u.getFullName(),
                    "username", u.getUsername(),
                    "role", u.getRole(),
                    "email", u.getEmail(),
                    "deaconFamily", u.getDeaconFamily(),
                    "phoneNumber", u.getPhoneNumber(),
                    "guardiansPhone", u.getGuardiansPhone(),
                    "address", u.getAddress()
            )));
        }

        List<Map<String, Object>> recordsSnap = new ArrayList<>();
        for (AttendanceRecord r : records) {
            if (r == null) continue;
            recordsSnap.add(new LinkedHashMap<>(Map.of(
                    "id", r.getId(),
                    "userId", r.getUser() == null ? null : r.getUser().getId(),
                    "userFullName", r.getUser() == null ? null : r.getUser().getFullName(),
                    "date", r.getDate() == null ? null : r.getDate().toString(),
                    "time", r.getTime() == null ? null : r.getTime().toString(),
                    "type", r.getType() == null ? null : r.getType().name(),
                    "status", r.getStatus() == null ? null : r.getStatus().name(),
                    "takenBy", r.getTakenBy() == null ? null : r.getTakenBy().getFullName(),
                    "createdAt", r.getCreatedAt() == null ? null : r.getCreatedAt().toString()
            )));
        }

        String usersJson;
        String recordsJson;
        try {
            usersJson = objectMapper.writeValueAsString(usersSnap);
            recordsJson = objectMapper.writeValueAsString(recordsSnap);
        } catch (Exception e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to build archive json");
        }

        AttendanceArchive archive = new AttendanceArchive();
        archive.setName(archiveName);
        archive.setCreatedByUsername(actor.getUsername());
        archive.setCreatedByFullName(actor.getFullName());
        archive.setTotalUsers(ids.size());
        archive.setTotalRecords(records.size());
        archive.setUsersJson(usersJson);
        archive.setRecordsJson(recordsJson);

        archive = archiveRepo.save(archive);

        // Archive (update) all active attendance records instead of deleting
        int updated = 0;
        if (!ids.isEmpty()) {
            final int CHUNK = 500;
            for (int i = 0; i < ids.size(); i += CHUNK) {
                List<Long> part = ids.subList(i, Math.min(i + CHUNK, ids.size()));
                updated += attendanceRepo.archiveByUserIds(part, archive);
            }
        }

        return ResponseEntity.ok(Map.of(
                "ok", true,
                "archiveId", archive.getId(),
                "archiveName", archive.getName(),
                "users", ids.size(),
                "archivedRecords", updated
        ));
    }

    // List all attendance archives
    @GetMapping("/archives")
    public ResponseEntity<?> archives(Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User actor = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String role = actor.getRole();
        boolean isDev = "DEVELOPER".equalsIgnoreCase(role);
        boolean isAminKhedma = "AMIN_KHEDMA".equalsIgnoreCase(role);
        if (!(isDev || isAminKhedma)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        List<AttendanceArchive> list = archiveRepo.findAll();
        // أحدث أولاً
        list.sort((a, b) -> {
            if (a.getCreatedAt() == null && b.getCreatedAt() == null) return 0;
            if (a.getCreatedAt() == null) return 1;
            if (b.getCreatedAt() == null) return -1;
            return b.getCreatedAt().compareTo(a.getCreatedAt());
        });

        List<Map<String, Object>> out = new ArrayList<>();
        for (AttendanceArchive a : list) {
            out.add(Map.of(
                    "id", a.getId(),
                    "name", a.getName(),
                    "createdAt", a.getCreatedAt() == null ? null : a.getCreatedAt().toString(),
                    "createdBy", a.getCreatedByFullName(),
                    "totalUsers", a.getTotalUsers(),
                    "totalRecords", a.getTotalRecords()
            ));
        }
        return ResponseEntity.ok(out);
    }

    // Download archive as PDF
    @GetMapping("/archives/{id}/pdf")
    public ResponseEntity<?> archivePdf(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User actor = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String role = actor.getRole();
        boolean isDev = "DEVELOPER".equalsIgnoreCase(role);
        boolean isAminKhedma = "AMIN_KHEDMA".equalsIgnoreCase(role);
        if (!(isDev || isAminKhedma)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        AttendanceArchive archive = archiveRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Archive not found"));

        byte[] pdfBytes;
        try {
            pdfBytes = buildArchivePdf(archive);
        } catch (Exception e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to generate pdf");
        }

        String safeName = archive.getName() == null ? "archive" : archive.getName().trim();
        if (safeName.isEmpty()) safeName = "archive";
        safeName = safeName.replaceAll("[\\\\/:*?\"<>|]", "_");

        String contentDisposition = buildContentDisposition(safeName + ".pdf");

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, contentDisposition)
                .contentType(MediaType.APPLICATION_PDF)
                .body(pdfBytes);
    }

    private byte[] buildArchivePdf(AttendanceArchive archive) throws Exception {

        silenceOpenHtmlToPdfLogs();

        List<Map<String, Object>> usersSnap = List.of();
        List<Map<String, Object>> recordsSnap = List.of();

        try {
            if (archive.getUsersJson() != null && !archive.getUsersJson().isBlank()) {
                usersSnap = objectMapper.readValue(
                        archive.getUsersJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {
                        }
                );
            }
            if (archive.getRecordsJson() != null && !archive.getRecordsJson().isBlank()) {
                recordsSnap = objectMapper.readValue(
                        archive.getRecordsJson(),
                        new com.fasterxml.jackson.core.type.TypeReference<List<Map<String, Object>>>() {
                        }
                );
            }
        } catch (Exception e) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "Failed to parse archive json");
        }

        // Group records by userId
        Map<Long, List<Map<String, Object>>> recordsByUser = recordsSnap.stream()
                .filter(r -> r.get("userId") != null)
                .collect(Collectors.groupingBy(r -> {
                    Object v = r.get("userId");
                    if (v instanceof Number n) return n.longValue();
                    return Long.parseLong(v.toString());
                }));

        // Build HTML (Arabic RTL)
        String html = buildArchiveHtmlArabic(archive, usersSnap, recordsByUser);
        html = html.replace("\uFEFF", "").trim(); // ✅ remove BOM + trim
        // Render to PDF
        try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            PdfRendererBuilder builder = new PdfRendererBuilder();
            builder.withHtmlContent(html, null);

            InputStream test = getClass().getResourceAsStream("/fonts/Amiri-Regular.ttf");
            if (test == null) {
                throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR,
                        "Arabic font missing: src/main/resources/fonts/Amiri-Regular.ttf");
            }
            try { test.close(); } catch (Exception ignored) {}

            builder.useFont(() -> getClass().getResourceAsStream("/fonts/Amiri-Regular.ttf"), "Amiri");

            builder.toStream(out);
            builder.useUnicodeBidiSplitter(new ICUBidiSplitter.ICUBidiSplitterFactory());
            builder.useUnicodeBidiReorderer(new ICUBidiReorderer());
            builder.defaultTextDirection(PdfRendererBuilder.TextDirection.RTL);
            builder.run();
            return out.toByteArray();
        }
    }

    private static void silenceOpenHtmlToPdfLogs() {
        if (OPENHTMLTOPDF_LOGS_SILENCED) return;
        synchronized (AttendanceController.class) {
            if (OPENHTMLTOPDF_LOGS_SILENCED) return;

            // Stop INFO spam like: com.openhtmltopdf.load INFO:: ...
            Logger.getLogger("com.openhtmltopdf").setLevel(Level.SEVERE);
            Logger.getLogger("com.openhtmltopdf.load").setLevel(Level.SEVERE);
            Logger.getLogger("com.openhtmltopdf.match").setLevel(Level.SEVERE);
            Logger.getLogger("com.openhtmltopdf.general").setLevel(Level.SEVERE);
            Logger.getLogger("com.openhtmltopdf.css-parse").setLevel(Level.SEVERE);

            OPENHTMLTOPDF_LOGS_SILENCED = true;
        }
    }

    private String buildArchiveHtmlArabic(
            AttendanceArchive archive,
            List<Map<String, Object>> usersSnap,
            Map<Long, List<Map<String, Object>>> recordsByUser
    ) {
        String name = safeStr(archive.getName());
        String createdAt = archive.getCreatedAt() == null ? "" : archive.getCreatedAt().toString();
        String createdBy = safeStr(archive.getCreatedByFullName());

        StringBuilder sb = new StringBuilder();
        sb.append("""
                <html xmlns="http://www.w3.org/1999/xhtml" lang="ar" dir="rtl">
                <head>
                <meta charset="UTF-8" />
                <style>
                  @page { size: A4; margin: 18mm 14mm; }
                  body { font-family: 'Amiri'; direction: rtl; font-size: 14px; }
                  h1 { margin: 0 0 8px 0; font-size: 22px; }
                  .meta { margin: 8px 0 14px 0; line-height: 1.8; }
                  .meta b { display: inline-block; min-width: 120px; }
                  .summary { margin: 10px 0 18px 0; padding: 10px; border: 1px solid #ddd; border-radius: 8px; }
                  .card { border: 1px solid #ddd; border-radius: 10px; padding: 12px; margin: 12px 0; page-break-inside: avoid; }
                  .row { display: block; margin: 2px 0; }
                  .label { color: #333; font-weight: bold; }
                  table { width: 100%; border-collapse: collapse; margin-top: 10px; }
                  th, td { border: 1px solid #ddd; padding: 7px; vertical-align: top; }
                  th { background: #f5f5f5; }
                  .muted { color: #555; }
                  .counts { margin-top: 6px; }
                  .counts span { margin-left: 14px; }
                  .page-break { page-break-after: always; }
                </style>
                </head>
                <body>
                
                <h1>أرشيف الحضور</h1>
                """);

        sb.append("<div class=\"meta\">");
        sb.append("<div><b>اسم الأرشيف:</b> ").append(esc(name)).append("</div>");
        sb.append("<div><b>تاريخ الإنشاء:</b> ").append(esc(createdAt)).append("</div>");
        sb.append("<div><b>تم بواسطة:</b> ").append(esc(createdBy)).append("</div>");
        sb.append("</div>");

        sb.append("<div class=\"summary\">");
        sb.append("<div><b>عدد المستخدمين:</b> ").append(archive.getTotalUsers() == null ? 0 : archive.getTotalUsers()).append("</div>");
        sb.append("<div><b>عدد سجلات الحضور:</b> ").append(archive.getTotalRecords() == null ? 0 : archive.getTotalRecords()).append("</div>");
        sb.append("</div>");

        // For each user in snapshot, show their data + full attendance history from snapshot records
        for (int i = 0; i < usersSnap.size(); i++) {
            Map<String, Object> u = usersSnap.get(i);
            Long userId = asLong(u.get("id"));
            String fullName = safeStr(u.get("fullName"));
            String username = safeStr(u.get("username"));
            String role = roleAr(safeStr(u.get("role")));
            String family = safeStr(u.get("deaconFamily"));
            String phone = safeStr(u.get("phoneNumber"));
            String gphone = safeStr(u.get("guardiansPhone"));
            String address = safeStr(u.get("address"));
            String email = safeStr(u.get("email"));

            List<Map<String, Object>> recs = userId == null ? List.of() : recordsByUser.getOrDefault(userId, List.of());

            // Count by type + status (present/absent)
            int friP = 0, friA = 0;
            int tasP = 0, tasA = 0;
            int famP = 0, famA = 0;
            int totalP = 0, totalA = 0;
            for (Map<String, Object> r : recs) {
                String t = safeStr(r.get("type"));
                String st = safeStr(r.get("status"));

                boolean present = "PRESENT".equalsIgnoreCase(st);
                boolean absent = "ABSENT".equalsIgnoreCase(st);
                if (present) totalP++;
                else if (absent) totalA++;

                if ("FRIDAY_LITURGY".equals(t)) {
                    if (present) friP++;
                    else if (absent) friA++;
                } else if ("TASBEEHA".equals(t)) {
                    if (present) tasP++;
                    else if (absent) tasA++;
                } else if ("FAMILY_MEETING".equals(t)) {
                    if (present) famP++;
                    else if (absent) famA++;
                }
            }

            sb.append("<div class=\"card\">");
            sb.append("<div class=\"row\"><span class=\"label\">الاسم:</span> ").append(esc(fullName)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">اليوزر:</span> ").append(esc(username)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">الدور:</span> ").append(esc(role)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">الأسرة:</span> ").append(esc(family)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">الموبايل:</span> ").append(esc(phone)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">موبايل ولي الأمر:</span> ").append(esc(gphone)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">العنوان:</span> ").append(esc(address)).append("</div>");
            sb.append("<div class=\"row muted\"><span class=\"label\">البريد:</span> ").append(esc(email)).append("</div>");

            sb.append("<div class=\"counts\">");
            sb.append("<span><b>قداس الجمعة:</b> ")
                    .append(friP + friA)
                    .append(" (حضور ").append(friP).append(" / غياب ").append(friA).append(")</span>");
            sb.append("<span><b>تسبحة:</b> ")
                    .append(tasP + tasA)
                    .append(" (حضور ").append(tasP).append(" / غياب ").append(tasA).append(")</span>");
            sb.append("<span><b>اجتماع أسرة:</b> ")
                    .append(famP + famA)
                    .append(" (حضور ").append(famP).append(" / غياب ").append(famA).append(")</span>");
            sb.append("<span><b>الإجمالي:</b> ")
                    .append(recs.size())
                    .append(" (حضور ").append(totalP).append(" / غياب ").append(totalA).append(")</span>");
            sb.append("</div>");

            sb.append("<table><thead><tr>");
            sb.append("<th>التاريخ</th><th>الوقت</th><th>النوع</th><th>الحالة</th><th>تم بواسطة</th>");
            sb.append("</tr></thead><tbody>");

            if (recs.isEmpty()) {
                sb.append("<tr><td colspan=\"5\">لا يوجد حضور مسجل</td></tr>");
            } else {
                // Group by type, then sort each group by date/time.
                // Also merge the "type" cell using rowspan so the type name doesn't repeat.
                List<String> typeOrder = List.of("TASBEEHA", "FRIDAY_LITURGY", "FAMILY_MEETING");
                Map<String, List<Map<String, Object>>> byType = new LinkedHashMap<>();
                for (String t : typeOrder) byType.put(t, new ArrayList<>());
                for (Map<String, Object> r : recs) {
                    String t = safeStr(r.get("type"));
                    byType.computeIfAbsent(t, k -> new ArrayList<>()).add(r);
                }

                for (Map.Entry<String, List<Map<String, Object>>> entry : byType.entrySet()) {
                    String rawType = entry.getKey();
                    List<Map<String, Object>> group = entry.getValue();
                    if (group == null || group.isEmpty()) continue;

                    group.sort((a, b) -> {
                        String da = safeStr(a.get("date"));
                        String db = safeStr(b.get("date"));
                        int c = da.compareTo(db);
                        if (c != 0) return c;
                        return safeStr(a.get("time")).compareTo(safeStr(b.get("time")));
                    });

                    String typeLabel = typeAr(rawType);
                    int rowspan = group.size();

                    for (int gi = 0; gi < group.size(); gi++) {
                        Map<String, Object> r = group.get(gi);
                        String date = safeStr(r.get("date"));
                        String time = safeStr(r.get("time"));
                        String status = statusAr(safeStr(r.get("status")));
                        String takenBy = safeStr(r.get("takenBy"));

                        sb.append("<tr>")
                                .append("<td>").append(esc(date)).append("</td>")
                                .append("<td>").append(esc(time)).append("</td>");

                        if (gi == 0) {
                            sb.append("<td rowspan=\"").append(rowspan).append("\">")
                                    .append(esc(typeLabel))
                                    .append("</td>");
                        }

                        sb.append("<td>").append(esc(status)).append("</td>")
                                .append("<td>").append(esc(takenBy)).append("</td>")
                                .append("</tr>");
                    }
                }
            }

            sb.append("</tbody></table>");
            sb.append("</div>");

            // optional page break every 3 users
            if ((i + 1) % 3 == 0) {
                sb.append("<div class=\"page-break\"></div>");
            }
        }

        sb.append("</body></html>");
        return sb.toString();
    }

    private static Long asLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number n) return n.longValue();
        try {
            return Long.parseLong(v.toString());
        } catch (Exception e) {
            return null;
        }
    }

    private static String safeStr(Object v) {
        return v == null ? "" : v.toString();
    }

    private static String esc(String s) {
        if (s == null) return "";
        return s.replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;");
    }

    private static boolean hasArabic(String s) {
        if (s == null || s.isEmpty()) return false;
        for (int i = 0; i < s.length(); i++) {
            char ch = s.charAt(i);
            // Arabic blocks: 0600–06FF, 0750–077F, 08A0–08FF, FB50–FDFF, FE70–FEFF
            if ((ch >= 0x0600 && ch <= 0x06FF)
                    || (ch >= 0x0750 && ch <= 0x077F)
                    || (ch >= 0x08A0 && ch <= 0x08FF)
                    || (ch >= 0xFB50 && ch <= 0xFDFF)
                    || (ch >= 0xFE70 && ch <= 0xFEFF)) {
                return true;
            }
        }
        return false;
    }

    private static String arabicVisual(String input) {
        if (input == null || input.isEmpty()) return "";
        try {
            // وصل الحروف فقط، وسيب الترتيب للـHTML + Renderer (dir=rtl)
            ArabicShaping shaper = new ArabicShaping(
                    ArabicShaping.LETTERS_SHAPE | ArabicShaping.TEXT_DIRECTION_LOGICAL
            );
            return shaper.shape(input);
        } catch (Exception e) {
            return input;
        }
    }

    private static String typeAr(String t) {
        return switch (t) {
            case "FRIDAY_LITURGY" -> "قداس الجمعة";
            case "TASBEEHA" -> "تسبحة";
            case "FAMILY_MEETING" -> "اجتماع أسرة";
            default -> (t == null || t.isBlank()) ? "" : t;
        };
    }

    private static String statusAr(String s) {
        return switch (s) {
            case "PRESENT" -> "حاضر";
            case "ABSENT" -> "غائب";
            default -> (s == null || s.isBlank()) ? "" : s;
        };
    }

    private static String roleAr(String r) {
        return switch (r) {
            case "MAKHDOM" -> "مخدوم";
            case "KHADIM" -> "خادم";
            case "AMIN_OSRA" -> "أمين أسرة";
            case "AMIN_KHEDMA" -> "أمين خدمة";
            case "DEVELOPER" -> "مطور";
            default -> (r == null || r.isBlank()) ? "" : r;
        };
    }

    private static String buildContentDisposition(String filename) {
        if (filename == null || filename.isBlank()) filename = "archive.pdf";
        String fallback = filename.replaceAll("[^A-Za-z0-9._-]", "_");
        if (fallback.isBlank()) fallback = "archive.pdf";
        String utf8 = java.net.URLEncoder.encode(filename, java.nio.charset.StandardCharsets.UTF_8)
                .replace("+", "%20");
        return "attachment; filename=\"" + fallback + "\"; filename*=UTF-8''" + utf8;
    }
}