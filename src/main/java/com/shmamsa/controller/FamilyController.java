package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.service.AttendanceBackfillService;
import com.shmamsa.service.KhorsJoinRequestService;
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
    private final KhorsJoinRequestService khorsReqService;
    private final AttendanceBackfillService attendanceBackfillService;

    private String baseFamilyOf(User u) {
        return u == null ? null : FamilyUtil.mainFamily(u.getDeaconFamily());
    }

    private static String normRole(String raw) {
        if (raw == null) return "";
        String r = raw.trim();

        r = r.replace("ROLE_", "");

        String upper = r.toUpperCase().replaceAll("[-\\s]+", "_");

        String ar = r.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .trim()
                .replaceAll("\\s+", " ");

        if (ar.equals("خادم")) return "KHADIM";
        if (ar.equals("امين اسرة") || ar.equals("أمين أسرة") || ar.equals("امين الاسرة") || ar.equals("أمين الاسره") || ar.equals("امين الأسرة")) return "AMIN_OSRA";
        if (ar.equals("امين خدمة") || ar.equals("أمين خدمة") || ar.equals("امين الخدمه") || ar.equals("أمين الخدمه")) return "AMIN_KHEDMA";

        return upper;
    }

    private static List<String> expandRoles(List<String> canonical) {
        Set<String> out = new LinkedHashSet<>();
        for (String r : canonical) {
            if (r == null) continue;
            String x = r.trim();
            out.add(x);
            out.add("ROLE_" + x);

            if ("MAKHDOM".equals(x)) out.add("مخدوم");
            if ("KHADIM".equals(x)) out.add("خادم");

            if ("AMIN_OSRA".equals(x)) {
                out.add("امين اسرة");
                out.add("أمين أسرة");
                out.add("امين الاسرة");
                out.add("امين الأسرة");
            }

            if ("AMIN_KHEDMA".equals(x)) {
                out.add("امين خدمة");
                out.add("أمين خدمة");
                out.add("امين الخدمه");
                out.add("أمين الخدمه");
            }
        }
        return new ArrayList<>(out);
    }
    private List<String> servingBasesOf(User u) {
        if (u == null) return List.of();
        Set<String> set = new LinkedHashSet<>();
        addServingBase(set, u.getDeaconFamily(), u.getDeaconFamilyRole() == null ? u.getRole() : u.getDeaconFamilyRole());
        addServingBase(set, u.getDeaconFamily2(), u.getDeaconFamilyRole2());
        addServingBase(set, u.getDeaconFamily3(), u.getDeaconFamilyRole3());
        addServingBase(set, u.getDeaconFamily4(), u.getDeaconFamilyRole4());

        String role = normRole(u.getRole());
        if ("KHADIM".equals(role)) {
            String scope = u.getServingScope() == null ? "" : u.getServingScope().trim().toUpperCase();
            if ("KHORS_ONLY".equals(scope) || "BOTH".equals(scope)) {
                String k = u.getKhors() == null ? "" : u.getKhors().trim().toUpperCase();
                if ("MARMARKOS".equals(k) || "BOTH".equals(k)) set.add("خورس مارمرقس");
                if ("ATHANASIUS".equals(k) || "BOTH".equals(k)) set.add("خورس البابا اثناسيوس");
            }
        }
        return new ArrayList<>(set);
    }

    private void addServingBase(Set<String> set, String family, String role) {
        String base = FamilyUtil.mainFamily(family);
        String normalizedRole = normRole(role);
        if (base == null || base.isBlank() || "SYSTEM".equalsIgnoreCase(base)) return;
        if (!RoleUtil.isAtLeast(normalizedRole, "KHADIM")) return;
        set.add(base);
    }

    private static boolean isChoirBucket(String base) {
        if (base == null) return false;
        String x = base.trim();
        return x.equalsIgnoreCase("خورس مارمرقس") || x.equalsIgnoreCase("خورس البابا اثناسيوس") ;
    }

    private static String choirCodeFromBucket(String base) {
        if (base == null) return null;
        String x = base.trim();
        if (x.equalsIgnoreCase("خورس مارمرقس")) return "MARMARKOS";
        if (x.equalsIgnoreCase("خورس البابا اثناسيوس") ) return "ATHANASIUS";
        return null;
    }

    @GetMapping("/families")
public ResponseEntity<?> families(
        @RequestParam(required = false) String context,
        Authentication auth
) {
    if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

    User me = userRepo.findByUsername(auth.getName()).orElse(null);

        String role = normRole(me == null ? null : me.getRole());
        boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role);
        boolean isKhadim = "KHADIM".equals(role);
        boolean isAminOsra = "AMIN_OSRA".equals(role);

       boolean attendanceContext = context != null && "attendance".equalsIgnoreCase(context.trim());

    if (isKhadim && !attendanceContext) {
        List<String> out = servingBasesOf(me);
        out.sort(String::compareTo);
        return ResponseEntity.ok(out);
    }


    Set<String> set = new HashSet<>();
    for (User u : userRepo.findAll()) {
        if (u.getDeaconFamily() == null) continue;
        if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

        String base = FamilyUtil.mainFamily(u.getDeaconFamily());
        if (base == null || base.isBlank()) continue;
        if ("SYSTEM".equalsIgnoreCase(base)) continue;

        set.add(base);
    }

    set.add("خورس مارمرقس");
    // ✅ keep both labels (some UIs show "الانبا" وبعضها "البابا")
    set.add("خورس البابا اثناسيوس");
    
    List<String> out = new ArrayList<>(set);
    out.sort(String::compareTo);
    return ResponseEntity.ok(out);
}


@GetMapping("/members")

    public ResponseEntity<?> members(
            @RequestParam(required = false) String family,
            @RequestParam(required = false, defaultValue = "false") boolean includeSelf,
            @RequestParam(required = false) String context,
            Authentication auth
    ) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

    String role = normRole(me.getRole());
    boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role);
    boolean isAminOsra = "AMIN_OSRA".equals(role);
    boolean isKhadim = "KHADIM".equals(role);

        boolean servantsBucket = isAminKhedmaOrDev && family != null && "SERVANTS".equalsIgnoreCase(family.trim());


boolean hasFamilySelection = family != null && !family.isBlank();

String effectiveRole = hasFamilySelection ? effectiveRoleIn(me, family) : role;
boolean effIsAminOsra = "AMIN_OSRA".equals(effectiveRole);

boolean attendanceContext = context != null && "attendance".equalsIgnoreCase(context.trim());
boolean aminOsraAttendanceContext = effIsAminOsra && hasFamilySelection && attendanceContext;

if (isKhadim && hasFamilySelection && !attendanceContext) {
    String selectedBase = FamilyUtil.mainFamily(family);
    List<String> myBases = servingBasesOf(me);
    if (selectedBase == null || myBases.stream().noneMatch(b -> b.equalsIgnoreCase(selectedBase))) {
        throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
    }
}

    boolean khadimSelectedContext = isKhadim && hasFamilySelection;

    boolean canSelectFamily = isAminKhedmaOrDev || khadimSelectedContext || aminOsraAttendanceContext || effIsAminOsra;

    String target = (canSelectFamily && hasFamilySelection)
            ? family
            : me.getDeaconFamily();
    String base = servantsBucket ? null : FamilyUtil.mainFamily(target);

    if (base != null) base = base.trim();
    List<String> rolesToShow;
    if (isAminKhedmaOrDev) {
        rolesToShow = expandRoles(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
    } else if (effIsAminOsra) {
        rolesToShow = attendanceContext
                ? expandRoles(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"))
                : expandRoles(List.of("MAKHDOM", "KHADIM"));
    } else if (isKhadim) {
        rolesToShow = attendanceContext
                ? expandRoles(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"))
                : expandRoles(List.of("MAKHDOM"));
    } else {
        rolesToShow = expandRoles(List.of("MAKHDOM"));
    }

    // ✅ If viewing a choir bucket explicitly (Mar Markos / Baba Athanasius), show ALL account roles
    //    (KHADIM + MAKHDOM + AMIN_OSRA + AMIN_KHEDMA) regardless of viewer role/mode.
    if (!servantsBucket && hasFamilySelection && isChoirBucket(base)) {
        rolesToShow = expandRoles(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
    }

        List<User> members;
if (servantsBucket) {
    members = userRepo.findByRoleIn(List.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
} else if (isKhadim && !hasFamilySelection) {
    List<String> myBases = servingBasesOf(me);
    Map<Long, User> uniq = new LinkedHashMap<>();
    for (String b : myBases) {
        for (User u : userRepo.findByDeaconFamilyStartingWithAndRoleIn(b, rolesToShow)) {
            if (u.getId() != null) uniq.put(u.getId(), u);
        }
    }
    members = new ArrayList<>(uniq.values());
} else {
    if (isChoirBucket(base)) {
        String code = choirCodeFromBucket(base);

        List<User> a = userRepo.findByKhorsAndRoleIn(code, rolesToShow);
        List<User> b = userRepo.findByAttendKhorsAndRoleIn(code, rolesToShow);

        Map<Long, User> map = new LinkedHashMap<>();
        for (User u : a) map.put(u.getId(), u);
        for (User u : b) map.put(u.getId(), u);

        members = new ArrayList<>(map.values());
    } else {
        members = userRepo.findByAnyFamilyStartingWithAndRoleIn(base, rolesToShow);
    }
}

        // ✅ عند اختيار خورس اثناسيوس (البابا/الانبا): استبعد زوار النقل (علشان العدد كبير)
        if (!servantsBucket && hasFamilySelection && base != null &&
                base.trim().equals("خورس البابا اثناسيوس")) {
            members = members.stream().filter(u -> !isTransferVisitorUser(u))
                    .collect(java.util.stream.Collectors.toList());
        }

        List<Map<String, Object>> out = new ArrayList<>();
        for (User u : members) {

            if (!includeSelf && me.getId() != null && me.getId().equals(u.getId())) continue;

            long fridayTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeehaTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.TASBEEHA);
            long meetingTotal = base == null || base.isBlank() || isChoirBucket(base)
                    ? attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.FAMILY_MEETING)
                    : attendanceRepo.countByUser_IdAndTypeAndFamilyBaseAndArchivedFalse(u.getId(), AttendanceType.FAMILY_MEETING, base);

            // ✅ Choir totals (only meaningful for choir members)
            long marmarkosTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.MARMARKOS_KHORS);
            long athanasiusTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.ATHANASIUS_KHORS);

            long fridayPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeehaPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.TASBEEHA);
            long meetingPresent = base == null || base.isBlank() || isChoirBucket(base)
                    ? attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.FAMILY_MEETING)
                    : attendanceRepo.countPresentByUserAndTypeAndFamilyBaseActive(u.getId(), AttendanceType.FAMILY_MEETING, base);

            long marmarkosPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.MARMARKOS_KHORS);
            long athanasiusPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.ATHANASIUS_KHORS);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", u.getId());
            row.put("fullName", u.getFullName());
            row.put("role", u.getRole());
            row.put("deaconFamily", u.getDeaconFamily());
            row.put("deaconFamily2", u.getDeaconFamily2());
            row.put("deaconFamily3", u.getDeaconFamily3());
            row.put("deaconFamily4", u.getDeaconFamily4());
            row.put("deaconFamilyRole", u.getDeaconFamilyRole());
            row.put("deaconFamilyRole2", u.getDeaconFamilyRole2());
            row.put("deaconFamilyRole3", u.getDeaconFamilyRole3());
            row.put("deaconFamilyRole4", u.getDeaconFamilyRole4());
            row.put("address", u.getAddress());
            row.put("phoneNumber", u.getPhoneNumber());
            row.put("guardiansPhone", u.getGuardiansPhone());
            row.put("fridayLiturgy", fridayPresent);
            row.put("tasbeeha", tasbeehaPresent);
            row.put("familyMeeting", meetingPresent);
            row.put("fridayLiturgyPresent", fridayPresent);
            row.put("fridayLiturgyTotal", fridayTotal);
            row.put("tasbeehaPresent", tasbeehaPresent);
            row.put("tasbeehaTotal", tasbeehaTotal);
            row.put("familyMeetingPresent", meetingPresent);
            row.put("familyMeetingTotal", meetingTotal);
            row.put("marmarkosKhorsPresent", marmarkosPresent);
            row.put("marmarkosKhorsTotal", marmarkosTotal);
            row.put("athanasiusKhorsPresent", athanasiusPresent);
            row.put("athanasiusKhorsTotal", athanasiusTotal);
            row.put("khors", u.getKhors());
            row.put("khorsYear", u.getKhorsYear());
            row.put("servingScope", u.getServingScope());
            out.add(row);
        }

        return ResponseEntity.ok(out);
    }


    @GetMapping("/members/{id}")
    public ResponseEntity<?> member(@PathVariable Long id,
                                    @RequestParam(required = false) String family,
                                    Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        User u = userRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Member not found"));

        boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(me.getRole()) || "DEVELOPER".equals(me.getRole());


        boolean hasFamilySelection = family != null && !family.isBlank();
        boolean isKhadim = "KHADIM".equals(me.getRole());
        boolean khadimSelectedContext = isKhadim && hasFamilySelection;

        String target = ((isAminKhedmaOrDev || khadimSelectedContext) && hasFamilySelection)
                ? family
                : me.getDeaconFamily();
        String base = FamilyUtil.mainFamily(target);
        String uBase = familyBaseMatch(u, base);

        if (!isAminKhedmaOrDev) {
    if (isKhadim) {
        List<String> myBases = servingBasesOf(me);
        if (uBase == null || myBases.stream().noneMatch(b -> b.equalsIgnoreCase(uBase))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
    } else {
        if (base == null || uBase == null || !base.equals(uBase)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
    }
}

        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", u.getId());
        dto.put("fullName", u.getFullName());
        dto.put("username", u.getUsername());
        dto.put("email", u.getEmail());
        dto.put("role", u.getRole());
        dto.put("deaconFamily", u.getDeaconFamily());
        dto.put("deaconFamily2", u.getDeaconFamily2());
        dto.put("deaconFamily3", u.getDeaconFamily3());
        dto.put("deaconFamily4", u.getDeaconFamily4());
        dto.put("deaconDegree", u.getDeaconDegree());
        dto.put("nationalId", u.getNationalId());
        dto.put("phoneNumber", u.getPhoneNumber());
        dto.put("address", u.getAddress());
        dto.put("guardiansPhone", u.getGuardiansPhone());
        dto.put("guardianRelation", u.getGuardianRelation());
        dto.put("dateOfBirth", u.getDateOfBirth());
        dto.put("gender", u.getGender());
        dto.put("status", u.getStatus());
        dto.put("studyType", u.getStudyType());
        dto.put("schoolName", u.getSchoolName());
        dto.put("schoolGrade", u.getSchoolGrade());
        dto.put("universityName", u.getUniversityName());
        dto.put("faculty", u.getFaculty());
        dto.put("universityGrade", u.getUniversityGrade());
        dto.put("graduatedFrom", u.getGraduatedFrom());
        dto.put("graduateJob", u.getGraduateJob());
        dto.put("isWorking", u.getIsWorking());
        dto.put("workDetails", u.getWorkDetails());
        dto.put("khors", u.getKhors());
        dto.put("khorsYear", u.getKhorsYear());
        return ResponseEntity.ok(dto);
    }



    @DeleteMapping("/members/{id}")
    public ResponseEntity<?> deleteMember(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String myRole = me.getRole();
        boolean isDev = "DEVELOPER".equals(myRole);
        boolean isAminKhedma = "AMIN_KHEDMA".equals(myRole);
        boolean isAminOsra = "AMIN_OSRA".equals(myRole);

        boolean isKhadim = "KHADIM".equalsIgnoreCase(me.getRole());

        if (!(isDev || isAminKhedma || isAminOsra || isKhadim)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }



        User target = userRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Member not found"));

        if (me.getId() != null && me.getId().equals(target.getId())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Cannot delete your own account");
        }

        if ("DEVELOPER".equalsIgnoreCase(target.getRole())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Cannot delete DEVELOPER account");
        }

        // AMIN_OSRA restrictions: only MAKHDOM inside his own family
        if (isAminOsra) {
            String myBase = baseFamilyOf(me);
            String targetBase = baseFamilyOf(target);
            if (myBase == null || targetBase == null || !myBase.equals(targetBase)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
            if (!"MAKHDOM".equalsIgnoreCase(target.getRole())) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        attendanceRepo.deleteByUserOrTakenBy(target.getId());

        userRepo.deleteById(target.getId());

        return ResponseEntity.ok(Map.of(
                "message", "User deleted",
                "userId", target.getId()
        ));
    }

    private static boolean isKhorsYearToken(String s) {
        if (s == null) return false;
        return s.toUpperCase(Locale.ROOT).startsWith("KHORS:");
    }

    private static boolean isKhorsRequestToken(String s) {
        if (s == null) return false;
        return s.toUpperCase(Locale.ROOT).startsWith("KHORS_REQUEST:");
    }

    private static String parseKhorsFromYearToken(String s) {
        // KHORS:MARMARKOS:YEAR:2
        String[] p = s.split(":");
        return (p.length >= 2) ? p[1].trim().toUpperCase(Locale.ROOT) : null;
    }

    private static Integer parseYearFromToken(String s) {
        // KHORS:MARMARKOS:YEAR:2
        String[] p = s.split(":");
        if (p.length >= 4) {
            try { return Integer.valueOf(p[3].trim()); } catch (Exception ignored) {}
        }
        return null;
    }

    private static String parseRequestedKhors(String s) {
        // KHORS_REQUEST:ATHANASIUS
        String[] p = s.split(":");
        return (p.length >= 2) ? p[1].trim().toUpperCase(Locale.ROOT) : null;
    }

    private boolean canManageKhors(User me, String khorsCode) {
        if (me == null || khorsCode == null) return false;

        String role = normRole(me.getRole());
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) return true;

        // KHADIM allowed only if he serves that choir
        if ("KHADIM".equals(role)) {
            String scope = me.getServingScope() == null ? "" : me.getServingScope().trim().toUpperCase(Locale.ROOT);
            if (!("KHORS_ONLY".equals(scope) || "BOTH".equals(scope))) return false;

            String k = me.getKhors() == null ? "" : me.getKhors().trim().toUpperCase(Locale.ROOT);
            return "BOTH".equals(k) || k.equalsIgnoreCase(khorsCode);
        }

        return false;
    }

    @PostMapping("/transfer-members")
    public ResponseEntity<?> transferMembers(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String myRole = me.getRole();
        boolean isDev = "DEVELOPER".equalsIgnoreCase(myRole);
        boolean isAminKhedma = "AMIN_KHEDMA".equalsIgnoreCase(myRole);
        boolean isAminOsra = "AMIN_OSRA".equalsIgnoreCase(myRole);
        boolean isKhadim = "KHADIM".equalsIgnoreCase(myRole);

        Object idsObj = body.get("memberIds");
        String newFamily = body.get("newFamily") == null ? null : body.get("newFamily").toString();

        if (idsObj == null || newFamily == null || newFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "memberIds and newFamily are required");
        }

        String newFamilyTrim = newFamily.trim();

        boolean isKhorsYearMove = isKhorsYearToken(newFamilyTrim);
        boolean isKhorsRequestMove = isKhorsRequestToken(newFamilyTrim);

        String targetKhors = isKhorsYearMove ? parseKhorsFromYearToken(newFamilyTrim) : null;
        Integer targetYear = isKhorsYearMove ? parseYearFromToken(newFamilyTrim) : null;

        String requestedKhors = isKhorsRequestMove ? parseRequestedKhors(newFamilyTrim) : null;


        String transferFamily = body.get("transferFamily") == null ? null : body.get("transferFamily").toString();
        String transferFamilyBase = FamilyUtil.mainFamily(transferFamily);
        String effectiveActorRole = transferFamilyBase == null || transferFamilyBase.isBlank()
                ? normRole(me.getRole())
                : effectiveRoleIn(me, transferFamilyBase);
        boolean scopedAminOsra = "AMIN_OSRA".equals(effectiveActorRole);

        if (isKhorsYearMove) {
            if (!(isDev || isAminKhedma || isKhadim)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        } else if (isKhorsRequestMove) {
            if (!(isDev || isAminKhedma || isAminOsra || scopedAminOsra || isKhadim)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        } else {
            if (!(isDev || isAminKhedma || isAminOsra || scopedAminOsra)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        if (isKhorsYearMove) {
            if (targetKhors == null || targetYear == null || targetYear < 1 || targetYear > 5) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid khors year token");
            }
            if (!canManageKhors(me, targetKhors)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        if (isKhorsRequestMove) {
            if (requestedKhors == null || !(requestedKhors.equals("MARMARKOS") || requestedKhors.equals("ATHANASIUS"))) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid khors request");
            }
            // KHADIM can only create requests for the choir he serves
            if (isKhadim && !canManageKhors(me, requestedKhors)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        // parse ids
        List<Long> ids = new ArrayList<>();
        if (idsObj instanceof List<?> list) {
            for (Object o : list) {
                if (o == null) continue;
                ids.add(Long.valueOf(o.toString()));
            }
        }
        if (ids.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "No members selected");

        // ===== Existing fields (families transfer) =====
        String secondaryFamily = body.get("secondaryFamily") == null ? null : body.get("secondaryFamily").toString();
        Object extraFamiliesObj = body.get("extraFamilies");
        String targetRole = body.get("targetRole") == null ? null : body.get("targetRole").toString();
        String variant = body.get("variant") == null ? null : body.get("variant").toString(); // backward compatible

        // ✅ Optional role change (DEV/AMIN_KHEDMA only)
        String normalizedTargetRole = null;
        if (targetRole != null && !targetRole.isBlank()) {
            if (isAminOsra || scopedAminOsra) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            normalizedTargetRole = targetRole.trim().toUpperCase(Locale.ROOT);

            List<String> allowed = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");
            if (!allowed.contains(normalizedTargetRole)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid targetRole");
            }
            if (!RoleUtil.canAssign(myRole, normalizedTargetRole)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        // If this is khors operation, ignore family logic completely
        if (isKhorsYearMove || isKhorsRequestMove) {
            int updated = 0;

            for (Long id : ids) {
                if (id == null) continue;
                if (me.getId() != null && me.getId().equals(id)) continue;

                User u = userRepo.findById(id).orElse(null);
                if (u == null) continue;
                if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

                if (isKhorsYearMove) {
                    if (targetKhors == null || targetYear == null) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid khors move");
                    }

                    if ("ATHANASIUS".equalsIgnoreCase(targetKhors)) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "Athanasius khors has no years");
                    }

                    String currentKhors = (u.getKhors() == null) ? "" : u.getKhors().trim().toUpperCase(Locale.ROOT);
                    if (!currentKhors.equalsIgnoreCase(targetKhors)) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "User is not in this khors");
                    }

                    u.setKhorsYear(targetYear);
                    userRepo.save(u);
                    attendanceBackfillService.backfillForUser(u);
                    updated++;
                    continue;
                } else {
                    // ===== Choir join request move (no immediate join) =====
                    if (requestedKhors == null) {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid khors request");
                    }

                    // If AMIN_OSRA: only allowed for members in his base family
                    if (isAminOsra || scopedAminOsra) {
                        String actorBase = transferFamilyBase == null || transferFamilyBase.isBlank() ? baseFamilyOf(me) : transferFamilyBase;
                        String memberBase = familyBaseMatch(u, actorBase);
                        if (actorBase == null || memberBase == null || !actorBase.equalsIgnoreCase(memberBase)) {
                            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
                        }
                    }

                    String currentKhors = (u.getKhors() == null) ? "" : u.getKhors().trim().toUpperCase(Locale.ROOT);
                    String req = requestedKhors.trim().toUpperCase(Locale.ROOT);

                    if ("MARMARKOS".equals(req)) {
                        if ("MARMARKOS".equalsIgnoreCase(currentKhors)) {
                            throw new ApiException(HttpStatus.BAD_REQUEST, "User is already in Marmarkos");
                        }
                        if (currentKhors != null && !currentKhors.isBlank() && !"NONE".equalsIgnoreCase(currentKhors)) {
                            throw new ApiException(HttpStatus.BAD_REQUEST, "User is already in another khors");
                        }
                        khorsReqService.createForUserIfNeeded(u, "MARMARKOS");
                        updated++;
                    } else if ("ATHANASIUS".equals(req)) {
                        if ("ATHANASIUS".equalsIgnoreCase(currentKhors)) {
                            throw new ApiException(HttpStatus.BAD_REQUEST, "User is already in Athanasius");
                        }
                        // Existing behavior: Athanasius request is only for members currently in Marmarkos
                        if (!"MARMARKOS".equalsIgnoreCase(currentKhors)) {
                            throw new ApiException(HttpStatus.BAD_REQUEST, "User must be in Marmarkos to request Athanasius");
                        }
                        khorsReqService.createForUserIfNeeded(u, "ATHANASIUS");
                        updated++;
                    } else {
                        throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid khors request");
                    }
                }
            }

            return ResponseEntity.ok(Map.of("updated", updated));
        }

        // ===== Normal family transfer logic (your existing code continues) =====
        // (سيب هنا كود الأسر بتاعك زي ما هو تحت بدون تغيير)
        // -------------- START: your existing family-transfer block --------------
        List<String> specialKeywords = List.of("الانبا ابرام", "البابا كيرلس", "اسطفانوس");
        String targetBase = FamilyUtil.mainFamily(newFamilyTrim);
        boolean isSpecialTarget = (targetBase != null) && specialKeywords.stream().anyMatch(targetBase::contains);

        String effectiveFamily;
        if (targetBase == null || targetBase.isBlank()) {
            effectiveFamily = newFamilyTrim;
        } else if (!isSpecialTarget) {
            effectiveFamily = targetBase;
        } else {
            boolean alreadyAB = newFamilyTrim.matches(".*\\s[أب]$");
            if (alreadyAB) {
                effectiveFamily = newFamilyTrim;
            } else if (variant != null && !variant.isBlank()) {
                String v = variant.trim().toUpperCase(Locale.ROOT);
                if ("A".equals(v)) effectiveFamily = targetBase + " أ";
                else if ("B".equals(v)) effectiveFamily = targetBase + " ب";
                else if ("SERVANT".equals(v)) effectiveFamily = targetBase;
                else throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid variant");
            } else {
                effectiveFamily = targetBase;
            }
        }

        List<Map<String, String>> requestedExtras = new ArrayList<>();
        Object extraAssignmentsObj = body.get("extraAssignments");
        if (extraAssignmentsObj instanceof List<?> list) {
            for (Object o : list) {
                if (!(o instanceof Map<?, ?> item)) continue;
                String familyRaw = item.get("family") == null ? null : item.get("family").toString();
                String roleRaw = item.get("role") == null ? null : item.get("role").toString();
                if (familyRaw == null || familyRaw.isBlank()) continue;
                requestedExtras.add(Map.of(
                        "family", familyRaw.trim(),
                        "role", normRole(roleRaw == null || roleRaw.isBlank() ? "KHADIM" : roleRaw)
                ));
                if (requestedExtras.size() >= 3) break;
            }
        } else {
            if (extraFamiliesObj instanceof List<?> list) {
                for (Object o : list) {
                    if (o == null) continue;
                    String s = o.toString();
                    if (s != null && !s.isBlank()) {
                        requestedExtras.add(Map.of("family", s.trim(), "role", "KHADIM"));
                    }
                }
            } else if (secondaryFamily != null && !secondaryFamily.isBlank()) {
                requestedExtras.add(Map.of("family", secondaryFamily.trim(), "role", "KHADIM"));
            }
        }

        List<Map<String, String>> effectiveExtras = new ArrayList<>();
        for (Map<String, String> extra : requestedExtras) {
            String raw = extra.get("family");
            if (raw == null || raw.isBlank()) continue;
            String secTrim = raw.trim();
            String secBase = FamilyUtil.mainFamily(secTrim);
            boolean isSpecialSec = (secBase != null) && specialKeywords.stream().anyMatch(secBase::contains);

            String normalized;
            if (secBase == null || secBase.isBlank()) normalized = secTrim;
            else if (!isSpecialSec) normalized = secBase;
            else {
                boolean alreadyAB2 = secTrim.matches(".*\\s[أب]$");
                if (alreadyAB2) normalized = secTrim;
                else normalized = secBase;
            }

            if (normalized != null && !normalized.isBlank()) {
                effectiveExtras.add(Map.of(
                        "family", normalized.trim(),
                        "role", normRole(extra.get("role"))
                ));
                if (effectiveExtras.size() >= 3) break;
            }
        }

        if (effectiveFamily == null || effectiveFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid target family");
        }
        if (targetBase == null || targetBase.isBlank() || "SYSTEM".equalsIgnoreCase(targetBase)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid target family");
        }

        for (Map<String, String> extra : effectiveExtras) {
            String ef = extra.get("family");
            if (ef == null || ef.isBlank()) continue;
            String secBase = FamilyUtil.mainFamily(ef);
            if (secBase == null || secBase.isBlank() || "SYSTEM".equalsIgnoreCase(secBase)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid extra family");
            }
            String extraRole = normRole(extra.get("role"));
            if (!List.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "MAKHDOM").contains(extraRole)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid extra family role");
            }
        }

        String myBase = FamilyUtil.mainFamily(me.getDeaconFamily());
        int updated = 0;

        for (Long id : ids) {
            if (id == null) continue;
            if (me.getId() != null && me.getId().equals(id)) continue;

            User u = userRepo.findById(id).orElse(null);
            if (u == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

            if (isAminOsra || scopedAminOsra) {
                String actorBase = transferFamilyBase == null || transferFamilyBase.isBlank() ? myBase : transferFamilyBase;
                String actorScopedRole = effectiveRoleIn(me, actorBase);
                if (!"AMIN_OSRA".equals(actorScopedRole)) continue;
                String uBase = familyBaseMatch(u, actorBase);
                if (actorBase == null || uBase == null || !actorBase.equalsIgnoreCase(uBase)) continue;
                if (!("MAKHDOM".equalsIgnoreCase(u.getRole()))) continue;
            }

            if (isAminKhedma || isDev) {
                if (!( "MAKHDOM".equalsIgnoreCase(u.getRole())
                        || "KHADIM".equalsIgnoreCase(u.getRole())
                        || "AMIN_OSRA".equalsIgnoreCase(u.getRole())
                        || "AMIN_KHEDMA".equalsIgnoreCase(u.getRole()))) {
                    continue;
                }
            }

            if (normalizedTargetRole != null) {
                u.setRole(normalizedTargetRole);
            }

            u.setDeaconFamily(effectiveFamily.trim());
            u.setDeaconFamilyRole(normalizedTargetRole != null ? normalizedTargetRole : normRole(u.getRole()));

            String primBase = FamilyUtil.mainFamily(effectiveFamily);

            List<Map<String, String>> cleanExtras = new ArrayList<>();
            Set<String> seenBases = new LinkedHashSet<>();
            if (primBase != null && !primBase.isBlank()) seenBases.add(primBase);

            for (Map<String, String> extra : effectiveExtras) {
                String ef = extra.get("family");
                if (ef == null || ef.isBlank()) continue;
                String eb = FamilyUtil.mainFamily(ef);
                if (eb == null || eb.isBlank()) continue;
                if (seenBases.stream().anyMatch(x -> x.equalsIgnoreCase(eb))) continue;
                seenBases.add(eb);
                cleanExtras.add(Map.of(
                        "family", ef.trim(),
                        "role", normRole(extra.get("role"))
                ));
                if (cleanExtras.size() >= 3) break;
            }

            u.setDeaconFamily2(cleanExtras.size() >= 1 ? cleanExtras.get(0).get("family") : null);
            u.setDeaconFamily3(cleanExtras.size() >= 2 ? cleanExtras.get(1).get("family") : null);
            u.setDeaconFamily4(cleanExtras.size() >= 3 ? cleanExtras.get(2).get("family") : null);
            u.setDeaconFamilyRole2(cleanExtras.size() >= 1 ? cleanExtras.get(0).get("role") : null);
            u.setDeaconFamilyRole3(cleanExtras.size() >= 2 ? cleanExtras.get(1).get("role") : null);
            u.setDeaconFamilyRole4(cleanExtras.size() >= 3 ? cleanExtras.get(2).get("role") : null);

            userRepo.save(u);
            attendanceBackfillService.backfillForUser(u);
            updated++;

            if ("MAKHDOM".equalsIgnoreCase(u.getRole())) {
                attendanceRepo.deleteByUserId(u.getId());
            }
        }

        return ResponseEntity.ok(Map.of("updated", updated));
    }

    @GetMapping("/members/{id}/attendance")
    public ResponseEntity<?> memberAttendance(@PathVariable Long id,
                                              @RequestParam(required = false) AttendanceType type,
                                              Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        List<?> records = (type == null)
                ? attendanceRepo.findByUser_IdAndArchivedFalseOrderByCreatedAtDesc(id)
                : attendanceRepo.findByUser_IdAndTypeAndArchivedFalseOrderByCreatedAtDesc(id, type);

        // Light DTO: include who took the attendance/absence
        List<Map<String, Object>> out = new ArrayList<>();
        for (Object o : records) {
            var r = (com.shmamsa.model.AttendanceRecord) o;
            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", r.getId());
            row.put("type", r.getType());
            row.put("date", r.getDate());
            row.put("time", r.getTime());
            row.put("createdAt", r.getCreatedAt());
            row.put("status", r.getStatus() == null ? "PRESENT" : r.getStatus().name());

            if (r.getTakenBy() != null) {
                Map<String, Object> tb = new LinkedHashMap<>();
                tb.put("id", r.getTakenBy().getId());
                tb.put("fullName", r.getTakenBy().getFullName());
                tb.put("role", r.getTakenBy().getRole());
                row.put("takenBy", tb);
            } else {
                row.put("takenBy", null);
            }

            out.add(row);
        }

        return ResponseEntity.ok(out);
    }

    // زوار النقل: غالبًا بيكون مكتوب "زوار" داخل واحدة من حقول الأسرة
    private boolean isTransferVisitorUser(User u) {
        if (u == null) return false;
        String[] arr = new String[]{u.getDeaconFamily(), u.getDeaconFamily2(), u.getDeaconFamily3(), u.getDeaconFamily4()};
        for (String f : arr) {
            if (f == null) continue;
            String s = f.trim();
            if (s.contains("زوار") || s.contains("زائر")) {
                return true;
            }
        }
        // احتياط: لو فيه role مخصوص
        String r = (u.getRole() == null) ? "" : u.getRole().trim().toUpperCase();
        return r.equals("ZAYER") || r.equals("VISITOR") || r.equals("TRANSFER_VISITOR");
    }

    private String effectiveRoleIn(User me, String family) {
        if (me == null) return "MAKHDOM";
        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) return normRole(me.getRole());
        String scoped = me.roleForFamilyBase(base);
        if (scoped != null && !scoped.isBlank()) return normRole(scoped);
        return normRole(me.getRole());
    }

    private String familyBaseMatch(User user, String familyBase) {
        if (user == null || familyBase == null || familyBase.isBlank()) return null;
        String[] families = new String[]{user.getDeaconFamily(), user.getDeaconFamily2(), user.getDeaconFamily3(), user.getDeaconFamily4()};
        for (String family : families) {
            String base = FamilyUtil.mainFamily(family);
            if (base != null && base.equalsIgnoreCase(familyBase)) return base;
        }
        return null;
    }
    
}
