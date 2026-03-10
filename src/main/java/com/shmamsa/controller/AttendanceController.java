package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceArchive;
import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceStatus;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.GradeSheet;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.AttendanceArchiveRepository;
import com.shmamsa.repository.GradeSheetRepository;
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
import java.time.LocalDateTime;
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
    private final GradeSheetRepository gradeRepo;
    private final QrTokenService qrTokenService;
    private final ObjectMapper objectMapper;

    private static final String TITLE_META_SEPARATOR = "::max::";
    private static final List<String> PREFERRED_FAMILY_ORDER = List.of(
            "اسرة السمائين",
            "اسرة القديس ابانوب",
            "اسرة القديس ديسقورس",
            "اسرة القديس سيدهم بشاي",
            "اسرة القديس اسكلابيوس",
            "اسرة القديس البابا كيرلس",
            "اسرة القديس الانبا ابرام",
            "اسرة القديس اسطفانوس",
            "خورس مارمرقس",
            "خورس البابا اثناسيوس"
    );

    private record GradeColumn(String id, String title) {}
    private record SheetPayload(List<GradeColumn> columns, Map<String, Map<String, String>> rows) {}

    private String normRole(String raw) {
        if (raw == null) return "";
        String r = raw.trim();
        String upper = r.toUpperCase(Locale.ROOT).replaceAll("[-\\s]+", "_");
        String ar = r.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .trim()
                .replaceAll("\\s+", " ");
        if (ar.equals("خادم")) return "KHADIM";
        if (ar.equals("امين اسرة") || ar.equals("أمين أسرة") || ar.equals("امين الاسرة") || ar.equals("أمين الاسره") || ar.equals("امين الأسرة")) return "AMIN_OSRA";
        if (ar.equals("امين خدمة") || ar.equals("أمين خدمة") || ar.equals("امين الخدمه") || ar.equals("أمين الخدمه")) return "AMIN_KHEDMA";
        if (upper.startsWith("ROLE_")) return upper.substring(5);
        return upper;
    }

    private boolean hasAnyScopedAminPrivilege(User user) {
        if (user == null) return false;
        List<String> roles = List.of(
                normRole(user.getDeaconFamilyRole()),
                normRole(user.getDeaconFamilyRole2()),
                normRole(user.getDeaconFamilyRole3()),
                normRole(user.getDeaconFamilyRole4())
        );
        return roles.contains("AMIN_OSRA") || roles.contains("AMIN_KHEDMA");
    }

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
        String roleNorm = normRole(servant.getRole());
        boolean canOverrideWeekClose = roleNorm.equals("AMIN_OSRA")
                || roleNorm.equals("AMIN_KHEDMA")
                || roleNorm.equals("DEVELOPER")
                || roleNorm.equals("DEV")
                || hasAnyScopedAminPrivilege(servant);

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


        String selectedFamily = familyObj == null ? null : String.valueOf(familyObj);
        ScopeResult scopeResult = resolveScopeUsers(servant, type, selectedFamily);
        List<User> scope = scopeResult.users;
        String meetingBase = scopeResult.familyBase;


        for (Long id : presentIds) {
            AttendanceRecord existing = (meetingBase != null && !meetingBase.isBlank())
                    ? attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(id, selectedDate, type, meetingBase)
                    : attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(id, selectedDate, type);
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
            if (meetingBase != null && !meetingBase.isBlank()) {
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

            AttendanceRecord existing = (meetingBase != null && !meetingBase.isBlank())
                    ? attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(target.getId(), selectedDate, type, meetingBase)
                    : attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(target.getId(), selectedDate, type);
            if (existing != null) {
                // keep as-is (if present, don't overwrite)
                continue;
            }

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(target);
            r.setDate(selectedDate);
            r.setTime(now);
            r.setType(type);
            if (meetingBase != null && !meetingBase.isBlank()) {
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
        if (selectedType == AttendanceType.FAMILY_MEETING && familyRaw != null && !familyRaw.isBlank()) {
            familyBase = FamilyUtil.mainFamily(familyRaw.trim());
        }

        AttendanceRecord existing = null;
        if (selectedType != null && selectedDate != null) {
            if (familyBase != null && !familyBase.isBlank()) {
                existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyBaseAndArchivedFalse(
                        u.getId(), selectedDate, selectedType, familyBase
                );
            } else if (selectedType != null) {
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
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", r.getId());
            row.put("date", r.getDate() == null ? null : r.getDate().toString());
            row.put("time", r.getTime() == null ? null : r.getTime().toString());
            row.put("type", r.getType() == null ? null : r.getType().name());
            row.put("status", r.getStatus() == null ? null : r.getStatus().name());
            row.put("takenBy", r.getTakenBy() == null ? null : r.getTakenBy().getFullName());
            row.put("familyBase", r.getFamilyBase());
            out.add(row);
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
        if (scope.familyBase != null && !scope.familyBase.isBlank()) {
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
        if (scope.familyBase != null && !scope.familyBase.isBlank()) {
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
        if (scope.familyBase != null && !scope.familyBase.isBlank()) {
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

        String roleNorm = normRole(servant.getRole());
        boolean canOverrideWeekClose = roleNorm.equals("AMIN_OSRA")
                || roleNorm.equals("AMIN_KHEDMA")
                || roleNorm.equals("DEVELOPER")
                || roleNorm.equals("DEV")
                || hasAnyScopedAminPrivilege(servant);

        if (selectedDate.isBefore(monday) && !canOverrideWeekClose) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "الاسبوع اتقفل (مش هينفع تعدل حاجه من الاسبوع اللي فات)");
        }
    }

    private void enforceDayOfWeek(AttendanceType type, LocalDate selectedDate) {
        if (type == null || selectedDate == null) return;
        DayOfWeek dow = selectedDate.getDayOfWeek();
        if (type == AttendanceType.FAMILY_MEETING
                && dow != DayOfWeek.THURSDAY
                && dow != DayOfWeek.FRIDAY
                && dow != DayOfWeek.SATURDAY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "الاسرة لازم تكون يوم خميس او جمعة");
        }
        if ((type == AttendanceType.FRIDAY_LITURGY
                || type == AttendanceType.MARMARKOS_KHORS
                || type == AttendanceType.ATHANASIUS_KHORS)
                && dow != DayOfWeek.FRIDAY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "القداس لازم يكون يوم الجمعة ");
        }
        if (type == AttendanceType.TASBEEHA && dow != DayOfWeek.SATURDAY) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "التسبحة لازم تكون يوم السبت");
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
            String familyBase = family != null && !family.isBlank() ? family.trim() : ("MARMARKOS".equals(needed) ? "خورس مارمرقس" : "خورس البابا اثناسيوس");
            return new ScopeResult(userRepo.findByKhorsAndRoleIn(needed, roles), familyBase);
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
                return new ScopeResult(userRepo.findByKhorsAndRoleIn(needed, roles), family.trim());
            }
        }

        // Friday liturgy / Tasbeeha are global across all families.
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
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", u.getId());
            row.put("fullName", u.getFullName());
            row.put("username", u.getUsername());
            row.put("role", u.getRole());
            row.put("email", u.getEmail());
            row.put("deaconFamily", u.getDeaconFamily());
            row.put("deaconFamily2", u.getDeaconFamily2());
            row.put("deaconFamily3", u.getDeaconFamily3());
            row.put("deaconFamily4", u.getDeaconFamily4());
            row.put("phoneNumber", u.getPhoneNumber());
            row.put("guardiansPhone", u.getGuardiansPhone());
            row.put("address", u.getAddress());
            usersSnap.add(row);
        }
        usersSnap.sort(this::compareArchiveUsers);

        List<Map<String, Object>> recordsSnap = new ArrayList<>();
        for (AttendanceRecord r : records) {
            if (r == null) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", r.getId());
            row.put("userId", r.getUser() == null ? null : r.getUser().getId());
            row.put("userFullName", r.getUser() == null ? null : r.getUser().getFullName());
            row.put("date", r.getDate() == null ? null : r.getDate().toString());
            row.put("time", r.getTime() == null ? null : r.getTime().toString());
            row.put("type", r.getType() == null ? null : r.getType().name());
            row.put("status", r.getStatus() == null ? null : r.getStatus().name());
            row.put("takenBy", r.getTakenBy() == null ? null : r.getTakenBy().getFullName());
            row.put("createdAt", r.getCreatedAt() == null ? null : r.getCreatedAt().toString());
            recordsSnap.add(row);
        }

        String usersJson;
        String recordsJson;
        String gradesJson;
        try {
            List<Map<String, Object>> gradesSnap = buildGradesSnapshot(targets);
            usersJson = objectMapper.writeValueAsString(usersSnap);
            recordsJson = objectMapper.writeValueAsString(recordsSnap);
            gradesJson = objectMapper.writeValueAsString(gradesSnap);
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
        archive.setGradesJson(gradesJson);

        archive = archiveRepo.save(archive);

        // Reset grades after archiving so the new year starts with empty sheets and no published results.
        for (GradeSheet sheet : gradeRepo.findAll()) {
            if (sheet == null) continue;
            sheet.setDataJson(null);
            sheet.setFirstTermDataJson(null);
            sheet.setSecondTermDataJson(null);
            sheet.setStatus("DRAFT");
            sheet.setUpdatedAt(LocalDateTime.now());
            sheet.setPublishedAt(null);
            sheet.setFirstPublishedAt(null);
            sheet.setSecondPublishedAt(null);
            sheet.setResultTerm(null);
            sheet.setPublishedByUserId(null);
            sheet.setFirstPublishedByUserId(null);
            sheet.setSecondPublishedByUserId(null);
            gradeRepo.save(sheet);
        }

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
        List<Map<String, Object>> gradesSnap = List.of();

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
            if (archive.getGradesJson() != null && !archive.getGradesJson().isBlank()) {
                gradesSnap = objectMapper.readValue(
                        archive.getGradesJson(),
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

        Map<Long, Map<String, Object>> gradesByUser = gradesSnap.stream()
                .filter(g -> g.get("userId") != null)
                .collect(Collectors.toMap(
                        g -> asLong(g.get("userId")),
                        g -> g,
                        (a, b) -> a,
                        LinkedHashMap::new
                ));

        // Build HTML (Arabic RTL)
        String html = buildArchiveHtmlArabic(archive, usersSnap, recordsByUser, gradesByUser);
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
            Map<Long, List<Map<String, Object>>> recordsByUser,
            Map<Long, Map<String, Object>> gradesByUser
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

        usersSnap = new ArrayList<>(usersSnap);
        usersSnap.sort(this::compareArchiveUsers);

        // For each user in snapshot, show their data + full attendance history + grades
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
            Map<String, Object> grades = userId == null ? null : gradesByUser.get(userId);

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
            sb.append("<th>تم بواسطة</th><th>الحالة</th><th>النوع</th><th>الوقت</th><th>التاريخ</th>");
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
                                .append("<td>").append(esc(takenBy)).append("</td>")
                                .append("<td>").append(esc(status)).append("</td>");

                        if (gi == 0) {
                            sb.append("<td rowspan=\"").append(rowspan).append("\">")
                                    .append(esc(typeLabel))
                                    .append("</td>");
                        }

                        sb.append("<td>").append(esc(time)).append("</td>")
                                .append("<td>").append(esc(date)).append("</td>")
                                .append("</tr>");
                    }
                }
            }

            sb.append("</tbody></table>");
            sb.append(buildArchivedGradesHtml(grades, fullName));
            sb.append("</div>");

            // optional page break every 3 users
            if ((i + 1) % 3 == 0) {
                sb.append("<div class=\"page-break\"></div>");
            }
        }

        sb.append("</body></html>");
        return sb.toString();
    }

    private List<Map<String, Object>> buildGradesSnapshot(List<User> targets) {
        Map<String, GradeSheet> sheetsByBase = gradeRepo.findAll().stream()
                .filter(Objects::nonNull)
                .filter(s -> s.getFamilyBase() != null && !s.getFamilyBase().isBlank())
                .collect(Collectors.toMap(
                        s -> FamilyUtil.mainFamily(s.getFamilyBase()),
                        s -> s,
                        (a, b) -> a,
                        LinkedHashMap::new
                ));

        Map<String, List<User>> membersByBase = new LinkedHashMap<>();
        for (User target : targets) {
            if (target == null || target.getId() == null) continue;
            String base = FamilyUtil.mainFamily(target.getDeaconFamily());
            if (base == null || base.isBlank()) continue;
            membersByBase.computeIfAbsent(base, ignored -> new ArrayList<>()).add(target);
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (User target : targets) {
            if (target == null || target.getId() == null) continue;
            if (!shouldArchiveGradesFor(target)) continue;

            String base = FamilyUtil.mainFamily(target.getDeaconFamily());
            GradeSheet sheet = (base == null || base.isBlank()) ? null : sheetsByBase.get(base);

            SheetPayload firstPayload = parseTermPayload(sheet, "FIRST");
            SheetPayload secondPayload = parseTermPayload(sheet, "SECOND");
            List<GradeColumn> firstCols = normalizedColumns(firstPayload);
            List<GradeColumn> secondCols = normalizedColumns(secondPayload);
            Map<String, Map<String, String>> firstRows = firstPayload.rows() == null ? Map.of() : firstPayload.rows();
            Map<String, Map<String, String>> secondRows = secondPayload.rows() == null ? Map.of() : secondPayload.rows();
            Map<String, String> firstValues = alignValues(firstCols, firstRows.get(String.valueOf(target.getId())));
            Map<String, String> secondValues = alignValues(secondCols, secondRows.get(String.valueOf(target.getId())));

            Integer firstRank = null;
            Integer secondRank = null;
            Integer combinedRank = null;

            List<User> familyMembers = membersByBase.getOrDefault(base, List.of());
            if (sheet != null && !familyMembers.isEmpty()) {
                Map<Long, Double> firstTotals = new HashMap<>();
                Map<Long, Double> secondTotals = new HashMap<>();
                Map<Long, Double> combinedTotals = new HashMap<>();
                for (User member : familyMembers) {
                    Map<String, String> memberFirst = alignValues(firstCols, firstRows.get(String.valueOf(member.getId())));
                    Map<String, String> memberSecond = alignValues(secondCols, secondRows.get(String.valueOf(member.getId())));
                    double firstTotal = totalForColumns(firstCols, memberFirst);
                    double secondTotal = totalForColumns(secondCols, memberSecond);
                    firstTotals.put(member.getId(), firstTotal);
                    secondTotals.put(member.getId(), secondTotal);
                    combinedTotals.put(member.getId(), firstTotal + secondTotal);
                }
                if (sheet.getFirstPublishedAt() != null) firstRank = rankForUser(familyMembers, firstTotals, target.getId());
                if (sheet.getSecondPublishedAt() != null) {
                    secondRank = rankForUser(familyMembers, secondTotals, target.getId());
                    combinedRank = rankForUser(familyMembers, combinedTotals, target.getId());
                }
            }

            if (sheet == null || sheet.getFirstPublishedAt() == null) {
                firstCols = List.of();
                firstValues = new LinkedHashMap<>();
            }
            if (sheet == null || sheet.getSecondPublishedAt() == null) {
                secondCols = List.of();
                secondValues = new LinkedHashMap<>();
            }

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("userId", target.getId());
            row.put("familyBase", base);
            row.put("firstPublishedAt", sheet == null || sheet.getFirstPublishedAt() == null ? null : sheet.getFirstPublishedAt().toString());
            row.put("secondPublishedAt", sheet == null || sheet.getSecondPublishedAt() == null ? null : sheet.getSecondPublishedAt().toString());
            row.put("firstRank", firstRank);
            row.put("secondRank", secondRank);
            row.put("combinedRank", combinedRank);
            row.put("firstColumns", columnsToMaps(firstCols));
            row.put("firstValues", firstValues);
            row.put("firstCells", cellsToMaps(firstCols, firstValues));
            row.put("secondColumns", columnsToMaps(secondCols));
            row.put("secondValues", secondValues);
            row.put("secondCells", cellsToMaps(secondCols, secondValues));
            out.add(row);
        }
        return out;
    }

    private boolean shouldArchiveGradesFor(User target) {
        if (target == null) return false;
        String base = FamilyUtil.mainFamily(target.getDeaconFamily());
        String role = safeStr(target.getRole()).trim().toUpperCase(Locale.ROOT);

        if ("خورس مارمرقس".equals(base)) {
            return !"KHADIM".equals(role) && !"AMIN_OSRA".equals(role) && !"AMIN_KHEDMA".equals(role)
                    || !isDedicatedKhorsServant(target, "MARMARKOS");
        }

        return "MAKHDOM".equals(role);
    }

    private boolean isDedicatedKhorsServant(User target, String khorsCode) {
        if (target == null) return false;
        String role = safeStr(target.getRole()).trim().toUpperCase(Locale.ROOT);
        if (!("KHADIM".equals(role) || "AMIN_OSRA".equals(role) || "AMIN_KHEDMA".equals(role))) return false;

        String scope = safeStr(target.getServingScope()).trim().toUpperCase(Locale.ROOT);
        if (!("KHORS_ONLY".equals(scope) || "BOTH".equals(scope))) return false;

        String khors = safeStr(target.getKhors()).trim().toUpperCase(Locale.ROOT);
        return "BOTH".equals(khors) || khors.equalsIgnoreCase(khorsCode);
    }

    private List<Map<String, Object>> columnsToMaps(List<GradeColumn> cols) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (cols == null) return out;
        for (GradeColumn c : cols) {
            if (c == null) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", c.id());
            row.put("title", c.title());
            out.add(row);
        }
        return out;
    }

    private List<Map<String, Object>> cellsToMaps(List<GradeColumn> cols, Map<String, String> values) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (cols == null) return out;
        Map<String, String> safeValues = values == null ? Map.of() : values;
        for (GradeColumn c : cols) {
            if (c == null) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", c.id());
            row.put("title", formatArchivedColumnTitle(c.title()));
            row.put("max", formatArchivedColumnMax(c.title()));
            String value = safeStr(safeValues.get(c.id())).trim();
            row.put("value", value.isBlank() ? "-" : value);
            out.add(row);
        }
        return out;
    }

    private SheetPayload emptyPayload() {
        return new SheetPayload(new ArrayList<>(), new LinkedHashMap<>());
    }

    private SheetPayload parsePayloadJson(String json) {
        if (json == null || json.isBlank()) return emptyPayload();
        try {
            return objectMapper.readValue(json, new com.fasterxml.jackson.core.type.TypeReference<SheetPayload>() {});
        } catch (Exception e) {
            return emptyPayload();
        }
    }

    private SheetPayload parseTermPayload(GradeSheet sheet, String term) {
        if (sheet == null) return emptyPayload();
        String normalized = "SECOND".equalsIgnoreCase(term) ? "SECOND" : "FIRST";
        String json = "SECOND".equals(normalized) ? sheet.getSecondTermDataJson() : sheet.getFirstTermDataJson();
        if ((json == null || json.isBlank()) && "FIRST".equals(normalized)) json = sheet.getDataJson();
        return parsePayloadJson(json);
    }

    private List<GradeColumn> normalizedColumns(SheetPayload payload) {
        return payload == null || payload.columns() == null ? new ArrayList<>() : new ArrayList<>(payload.columns());
    }

    private Map<String, String> alignValues(List<GradeColumn> cols, Map<String, String> values) {
        Map<String, String> aligned = new LinkedHashMap<>();
        Map<String, String> safe = values == null ? Map.of() : values;
        for (GradeColumn c : cols) aligned.put(c.id(), safe.getOrDefault(c.id(), ""));
        return aligned;
    }

    private double parseGradeNumber(String raw) {
        if (raw == null) return 0;
        String normalizedDigits = raw.trim()
                .replace('٠', '0').replace('١', '1').replace('٢', '2').replace('٣', '3').replace('٤', '4')
                .replace('٥', '5').replace('٦', '6').replace('٧', '7').replace('٨', '8').replace('٩', '9');
        String cleaned = normalizedDigits.replace(",", ".").replaceAll("[^\\d.\\-]", "");
        if (cleaned.isBlank()) return 0;
        try {
            return Double.parseDouble(cleaned);
        } catch (NumberFormatException ex) {
            return 0;
        }
    }

    private double totalForColumns(List<GradeColumn> cols, Map<String, String> values) {
        if (cols == null || cols.isEmpty() || values == null) return 0;
        double total = 0;
        for (GradeColumn c : cols) total += parseGradeNumber(values.get(c.id()));
        return total;
    }

    private Integer rankForUser(List<User> members, Map<Long, Double> totals, Long userId) {
        if (userId == null || members == null || members.isEmpty()) return null;
        List<User> ranked = new ArrayList<>(members);
        ranked.sort((a, b) -> {
            double totalDiff = totals.getOrDefault(b.getId(), 0d) - totals.getOrDefault(a.getId(), 0d);
            if (totalDiff > 0) return 1;
            if (totalDiff < 0) return -1;
            return String.valueOf(a.getFullName()).compareToIgnoreCase(String.valueOf(b.getFullName()));
        });

        Double lastTotal = null;
        int currentRank = 0;
        for (User member : ranked) {
            double total = totals.getOrDefault(member.getId(), 0d);
            if (lastTotal == null || Double.compare(total, lastTotal) != 0) {
                currentRank += 1;
                lastTotal = total;
            }
            if (Objects.equals(member.getId(), userId)) return currentRank;
        }
        return null;
    }

    @SuppressWarnings("unchecked")
    private String buildArchivedGradesHtml(Map<String, Object> grades, String fullName) {
        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"counts\" style=\"margin-top:14px\"><b>الدرجات المؤرشفة</b></div>");
        if (grades == null || grades.isEmpty()) {
            sb.append("<div class=\"row muted\">لا توجد درجات مؤرشفة</div>");
            return sb.toString();
        }

        List<Map<String, Object>> firstColumns = toMapList(grades.get("firstColumns"));
        List<Map<String, Object>> secondColumns = toMapList(grades.get("secondColumns"));
        List<Map<String, Object>> firstCells = toMapList(grades.get("firstCells"));
        List<Map<String, Object>> secondCells = toMapList(grades.get("secondCells"));
        Map<String, String> firstValues = toStringMap(grades.get("firstValues"));
        Map<String, String> secondValues = toStringMap(grades.get("secondValues"));
        Integer firstRank = asInt(grades.get("firstRank"));
        Integer secondRank = asInt(grades.get("secondRank"));
        Integer combinedRank = asInt(grades.get("combinedRank"));

        sb.append(buildGradesTableHtml("نتيجة الترم الأول", fullName, firstRank, firstCells, firstColumns, firstValues, "مجموع الترم الأول"));
        sb.append(buildGradesTableHtml("نتيجة الترم الثاني", fullName, secondRank, secondCells, secondColumns, secondValues, "مجموع الترم الثاني"));

        if (!secondColumns.isEmpty() || !secondValues.isEmpty() || combinedRank != null) {
            double firstTotal = totalForArchivedColumns(firstColumns, firstValues);
            double secondTotal = totalForArchivedColumns(secondColumns, secondValues);
            sb.append("<div class=\"row\" style=\"margin-top:10px\"><span class=\"label\">نتيجة الترمين معًا</span></div>");
            sb.append("<table><thead><tr><th>مجموع الترمين</th><th>مجموع الترم الثاني</th><th>مجموع الترم الأول</th><th>الاسم</th><th>م</th></tr></thead><tbody><tr>");
            sb.append("<td>").append(formatGradeTotal(firstTotal + secondTotal)).append("</td>");
            sb.append("<td>").append(formatGradeTotal(secondTotal)).append("</td>");
            sb.append("<td>").append(formatGradeTotal(firstTotal)).append("</td>");
            sb.append("<td>").append(esc(fullName)).append("</td>");
            sb.append("<td>").append(combinedRank == null ? "-" : combinedRank).append("</td>");
            sb.append("</tr></tbody></table>");
        }

        return sb.toString();
    }

    private String buildGradesTableHtml(String title,
                                        String fullName,
                                        Integer rank,
                                        List<Map<String, Object>> cells,
                                        List<Map<String, Object>> columns,
                                        Map<String, String> values,
                                        String totalTitle) {
        if ((cells == null || cells.isEmpty()) && (columns == null || columns.isEmpty()) && (values == null || values.isEmpty()) && rank == null) return "";

        StringBuilder sb = new StringBuilder();
        sb.append("<div class=\"row\" style=\"margin-top:10px\"><span class=\"label\">").append(esc(title)).append("</span></div>");
        sb.append("<table><thead><tr><th>").append(esc(totalTitle)).append("</th>");
        List<Map<String, Object>> displayCells = (cells == null || cells.isEmpty()) ? fallbackCellsFromColumns(columns, values) : cells;
        for (Map<String, Object> c : displayCells) {
            String display = safeStr(c.get("title"));
            String max = safeStr(c.get("max"));
            sb.append("<th>").append(esc(display));
            if (!max.isBlank()) sb.append(" / ").append(esc(max));
            sb.append("</th>");
        }
        sb.append("<th>الاسم</th><th>م</th></tr></thead><tbody><tr>");
        sb.append("<td>").append(formatGradeTotal(totalForArchivedColumns(columns, values))).append("</td>");
        for (Map<String, Object> c : displayCells) {
            sb.append("<td>").append(esc(safeStr(c.get("value")).isBlank() ? "-" : safeStr(c.get("value")))).append("</td>");
        }
        sb.append("<td>").append(esc(fullName)).append("</td>");
        sb.append("<td>").append(rank == null ? "-" : rank).append("</td>");
        sb.append("</tr></tbody></table>");
        return sb.toString();
    }

    private List<Map<String, Object>> fallbackCellsFromColumns(List<Map<String, Object>> columns, Map<String, String> values) {
        List<Map<String, Object>> out = new ArrayList<>();
        if (columns == null) return out;
        Map<String, String> safeValues = values == null ? Map.of() : values;
        for (Map<String, Object> c : columns) {
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("title", formatArchivedColumnTitle(safeStr(c.get("title"))));
            row.put("max", formatArchivedColumnMax(safeStr(c.get("title"))));
            String id = safeStr(c.get("id"));
            String value = safeStr(safeValues.get(id)).trim();
            row.put("value", value.isBlank() ? "-" : value);
            out.add(row);
        }
        return out;
    }

    private List<Map<String, Object>> toMapList(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object item : list) {
            if (!(item instanceof Map<?, ?> map)) continue;
            Map<String, Object> row = new LinkedHashMap<>();
            for (Map.Entry<?, ?> entry : map.entrySet()) row.put(String.valueOf(entry.getKey()), entry.getValue());
            out.add(row);
        }
        return out;
    }

    private Map<String, String> toStringMap(Object value) {
        if (!(value instanceof Map<?, ?> map)) return new LinkedHashMap<>();
        Map<String, String> out = new LinkedHashMap<>();
        for (Map.Entry<?, ?> entry : map.entrySet()) out.put(String.valueOf(entry.getKey()), safeStr(entry.getValue()));
        return out;
    }

    private Integer asInt(Object value) {
        if (value == null) return null;
        if (value instanceof Number number) return number.intValue();
        try {
            return Integer.parseInt(String.valueOf(value));
        } catch (Exception e) {
            return null;
        }
    }

    private double totalForArchivedColumns(List<Map<String, Object>> columns, Map<String, String> values) {
        if (columns == null || values == null) return 0;
        double total = 0;
        for (Map<String, Object> c : columns) total += parseGradeNumber(values.get(safeStr(c.get("id"))));
        return total;
    }

    private String formatArchivedColumnTitle(String rawTitle) {
        if (rawTitle == null || rawTitle.isBlank()) return "-";
        String[] parts = rawTitle.split(TITLE_META_SEPARATOR, -1);
        return parts.length == 0 || parts[0].isBlank() ? "-" : parts[0];
    }

    private String formatArchivedColumnMax(String rawTitle) {
        if (rawTitle == null || rawTitle.isBlank() || !rawTitle.contains(TITLE_META_SEPARATOR)) return "";
        String[] parts = rawTitle.split(TITLE_META_SEPARATOR, -1);
        if (parts.length < 2) return "";
        return String.join(TITLE_META_SEPARATOR, Arrays.copyOfRange(parts, 1, parts.length));
    }

    private String formatGradeTotal(double value) {
        if (Math.floor(value) == value) return String.valueOf((long) value);
        return String.format(Locale.US, "%.2f", value).replaceAll("0+$", "").replaceAll("\\.$", "");
    }

    private String normalizeArabicText(String value) {
        return String.valueOf(value == null ? "" : value)
                .trim()
                .replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا')
                .replace('ة', 'ه').replace('ى', 'ي')
                .replaceAll("\\s+", " ")
                .toLowerCase(Locale.ROOT);
    }

    private String canonicalFamilyName(Object value) {
        String raw = safeStr(value).trim();
        String normalized = normalizeArabicText(raw);
        if (normalized.isBlank()) return "";
        if (normalized.contains("خورس") && normalized.contains("مار") && normalized.contains("مرقس")) return "خورس مارمرقس";
        if (normalized.contains("خورس") && normalized.contains("اثناسيوس")) return "خورس البابا اثناسيوس";
        if (normalized.contains("سمائ")) return "اسرة السمائين";
        if (normalized.contains("ابانوب")) return "اسرة القديس ابانوب";
        if (normalized.contains("ديسقورس")) return "اسرة القديس ديسقورس";
        if (normalized.contains("سيدهم") || normalized.contains("بشاي")) return "اسرة القديس سيدهم بشاي";
        if (normalized.contains("اسكلابيوس")) return "اسرة القديس اسكلابيوس";
        if (normalized.contains("كيرلس")) return raw.contains(" ب") ? "اسرة القديس البابا كيرلس ب" : raw.contains(" أ") ? "اسرة القديس البابا كيرلس أ" : "اسرة القديس البابا كيرلس";
        if (normalized.contains("ابرام")) return raw.contains(" ب") ? "اسرة القديس الانبا ابرام ب" : raw.contains(" أ") ? "اسرة القديس الانبا ابرام أ" : "اسرة القديس الانبا ابرام";
        if (normalized.contains("اسطفانوس") || normalized.contains("استفانوس")) return raw.contains(" ب") ? "اسرة القديس اسطفانوس ب" : raw.contains(" أ") ? "اسرة القديس اسطفانوس أ" : "اسرة القديس اسطفانوس";
        return raw;
    }

    private int familyOrder(Object family) {
        String base = FamilyUtil.mainFamily(canonicalFamilyName(family));
        String normalized = normalizeArabicText(base);
        for (int i = 0; i < PREFERRED_FAMILY_ORDER.size(); i++) {
            if (normalizeArabicText(PREFERRED_FAMILY_ORDER.get(i)).equals(normalized)) return i;
        }
        return Integer.MAX_VALUE;
    }

    private int compareArchiveUsers(Map<String, Object> a, Map<String, Object> b) {
        int familyOrderCompare = Integer.compare(familyOrder(a.get("deaconFamily")), familyOrder(b.get("deaconFamily")));
        if (familyOrderCompare != 0) return familyOrderCompare;

        String aCanonical = canonicalFamilyName(a.get("deaconFamily"));
        String bCanonical = canonicalFamilyName(b.get("deaconFamily"));
        int familyCompare = aCanonical.compareToIgnoreCase(bCanonical);
        if (familyCompare != 0) return familyCompare;

        return safeStr(a.get("fullName")).compareToIgnoreCase(safeStr(b.get("fullName")));
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
