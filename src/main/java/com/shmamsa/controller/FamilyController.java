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

    private String baseFamilyOf(User u) {
        return u == null ? null : FamilyUtil.mainFamily(u.getDeaconFamily());
    }

private List<String> servingBasesOf(User u) {
    if (u == null) return List.of();
    Set<String> set = new LinkedHashSet<>();
    String b1 = FamilyUtil.mainFamily(u.getDeaconFamily());
    if (b1 != null && !b1.isBlank() && !"SYSTEM".equalsIgnoreCase(b1)) set.add(b1);
    String b2 = FamilyUtil.mainFamily(u.getDeaconFamily2());
    if (b2 != null && !b2.isBlank() && !"SYSTEM".equalsIgnoreCase(b2)) set.add(b2);
    String b3 = FamilyUtil.mainFamily(u.getDeaconFamily3());
    if (b3 != null && !b3.isBlank() && !"SYSTEM".equalsIgnoreCase(b3)) set.add(b3);
    String b4 = FamilyUtil.mainFamily(u.getDeaconFamily4());
    if (b4 != null && !b4.isBlank() && !"SYSTEM".equalsIgnoreCase(b4)) set.add(b4);

    // ✅ If KHADIM serves choir, add the choir bucket(s) to the allowed bases
    String role = u.getRole() == null ? "" : u.getRole().trim().toUpperCase();
    if ("KHADIM".equals(role)) {
        String scope = u.getServingScope() == null ? "" : u.getServingScope().trim().toUpperCase();
        if ("KHORS_ONLY".equals(scope) || "BOTH".equals(scope)) {
            String k = u.getKhors() == null ? "" : u.getKhors().trim().toUpperCase();
            if ("MARMARKOS".equals(k) || "BOTH".equals(k)) set.add("خورس مارمرقس");
            if ("ATHANASIUS".equals(k) || "BOTH".equals(k)) set.add("خورس الانبا اثناسيوس");
        }
    }
    return new ArrayList<>(set);
}

    private static boolean isChoirBucket(String base) {
        if (base == null) return false;
        String x = base.trim();
        return x.equalsIgnoreCase("خورس مارمرقس") || x.equalsIgnoreCase("خورس الانبا اثناسيوس");
    }

    private static String choirCodeFromBucket(String base) {
        if (base == null) return null;
        String x = base.trim();
        if (x.equalsIgnoreCase("خورس مارمرقس")) return "MARMARKOS";
        if (x.equalsIgnoreCase("خورس الانبا اثناسيوس")) return "ATHANASIUS";
        return null;
    }

    @GetMapping("/families")
public ResponseEntity<?> families(
        @RequestParam(required = false) String context,
        Authentication auth
) {
    if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

    User me = userRepo.findByUsername(auth.getName()).orElse(null);

    boolean isAminKhedmaOrDev = me != null && ("AMIN_KHEDMA".equals(me.getRole()) || "DEVELOPER".equals(me.getRole()));
    boolean isKhadim = me != null && "KHADIM".equals(me.getRole());

    // ✅ If KHADIM:
    // - default: return only where he serves (1..4 families / choir)
    // - context=attendance: allow picking any family (ONLY for "تسجيل الحضور" page)
    boolean attendanceContext = context != null && "attendance".equalsIgnoreCase(context.trim());
    if (isKhadim && !attendanceContext) {
        List<String> out = servingBasesOf(me);
        out.sort(String::compareTo);
        return ResponseEntity.ok(out);
    }

    // ✅ AMIN_KHEDMA / DEV: return all families in the system
    // ✅ AMIN_OSRA: also fine to return all for transfer UI
    Set<String> set = new HashSet<>();
    for (User u : userRepo.findAll()) {
        if (u.getDeaconFamily() == null) continue;
        if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

        String base = FamilyUtil.mainFamily(u.getDeaconFamily());
        if (base == null || base.isBlank()) continue;
        if ("SYSTEM".equalsIgnoreCase(base)) continue;

        set.add(base);
    }

    // ✅ Always include the 2 choirs as options (even if no users yet)
    set.add("خورس مارمرقس");
    set.add("خورس الانبا اثناسيوس");

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

        boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(me.getRole()) || "DEVELOPER".equals(me.getRole());
        boolean isAminOsra = "AMIN_OSRA".equals(me.getRole());
        boolean isKhadim = "KHADIM".equals(me.getRole());

        // ✅ Special bucket for AMIN_KHEDMA / DEV: "SERVANTS" shows KHADIM + AMIN_OSRA (across all families)
        boolean servantsBucket = isAminKhedmaOrDev && family != null && "SERVANTS".equalsIgnoreCase(family.trim());

        // ✅ Family selection rules
// - AMIN_KHEDMA / DEV: can pick any family from dropdown
// - KHADIM: can only pick from the places he serves in (1 or 2 families / choir)
// - Others: locked to their own family
boolean hasFamilySelection = family != null && !family.isBlank();

// ✅ "تسجيل الحضور" page can pass context=attendance to allow KHADIM to select ANY family.
boolean attendanceContext = context != null && "attendance".equalsIgnoreCase(context.trim());

// ✅ For KHADIM: allow selecting only if the family is one of his serving families
if (isKhadim && hasFamilySelection && !attendanceContext) {
    String selectedBase = FamilyUtil.mainFamily(family);
    List<String> myBases = servingBasesOf(me);
    if (selectedBase == null || myBases.stream().noneMatch(b -> b.equalsIgnoreCase(selectedBase))) {
        throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
    }
}

boolean khadimAttendanceContext = isKhadim && hasFamilySelection;

String target = ((isAminKhedmaOrDev || khadimAttendanceContext) && hasFamilySelection)
        ? family
        : me.getDeaconFamily();
String base = servantsBucket ? null : FamilyUtil.mainFamily(target);

        // ✅ Roles visible by permission level
        List<String> rolesToShow;
        if (isAminKhedmaOrDev) {
            rolesToShow = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");
        } else if (isAminOsra) {
            // ✅ Amin Osra can manage/transfer MAKHDOM only (not servants)
            rolesToShow = List.of("MAKHDOM");
        } else if (isKhadim) {
            // ✅ KHADIM:
            // - In "Members of your family" page (no 'family' param): keep old permissions (don't expose AMIN_KHEDMA)
            // - In attendance context (UI sends 'family' param when selecting a family): allow taking attendance/absence
            //   for all roles inside his family including AMIN_KHEDMA.
            boolean attendanceContext2 = family != null && !family.isBlank();
            rolesToShow = attendanceContext2
                    ? List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA")
                    // ✅ In Members page: show served members only
                    : List.of("MAKHDOM");
        } else {
            rolesToShow = List.of("MAKHDOM");
        }

        List<User> members;
if (servantsBucket) {
    members = userRepo.findByRoleIn(List.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
} else if (isKhadim && !hasFamilySelection) {
    // ✅ KHADIM "Members" page: show served members in ALL families he serves (primary + optional second)
    List<String> myBases = servingBasesOf(me);
    Map<Long, User> uniq = new LinkedHashMap<>();
    for (String b : myBases) {
        for (User u : userRepo.findByDeaconFamilyStartingWithAndRoleIn(b, rolesToShow)) {
            if (u.getId() != null) uniq.put(u.getId(), u);
        }
    }
    members = new ArrayList<>(uniq.values());
} else {
    // ✅ Choir bucket: use User.khors membership instead of deaconFamily
    if (isChoirBucket(base)) {
        String code = choirCodeFromBucket(base);
        members = userRepo.findByKhorsAndRoleIn(code, rolesToShow);
    } else {
        members = userRepo.findByDeaconFamilyStartingWithAndRoleIn(base, rolesToShow);
    }
}

        List<Map<String, Object>> out = new ArrayList<>();
        for (User u : members) {
            // ✅ Default behavior: don't show the logged-in account inside the members list
            // ✅ Attendance page can opt-in to include the current user via includeSelf=true
            if (!includeSelf && me.getId() != null && me.getId().equals(u.getId())) continue;

            long fridayTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeehaTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.TASBEEHA);
            long meetingTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.FAMILY_MEETING);

            // ✅ Choir totals (only meaningful for choir members)
            long marmarkosTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.MARMARKOS_KHORS);
            long athanasiusTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.ATHANASIUS_KHORS);

            long fridayPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeehaPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.TASBEEHA);
            long meetingPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.FAMILY_MEETING);

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
            row.put("address", u.getAddress());
            row.put("phoneNumber", u.getPhoneNumber());
            row.put("guardiansPhone", u.getGuardiansPhone());
            // Backward compatible (old UI): present count only
            row.put("fridayLiturgy", fridayPresent);
            row.put("tasbeeha", tasbeehaPresent);
            row.put("familyMeeting", meetingPresent);

            // New fields: present/total to display like 3/7
            row.put("fridayLiturgyPresent", fridayPresent);
            row.put("fridayLiturgyTotal", fridayTotal);
            row.put("tasbeehaPresent", tasbeehaPresent);
            row.put("tasbeehaTotal", tasbeehaTotal);
            row.put("familyMeetingPresent", meetingPresent);
            row.put("familyMeetingTotal", meetingTotal);

            // New: choir attendance
            row.put("marmarkosKhorsPresent", marmarkosPresent);
            row.put("marmarkosKhorsTotal", marmarkosTotal);
            row.put("athanasiusKhorsPresent", athanasiusPresent);
            row.put("athanasiusKhorsTotal", athanasiusTotal);
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

        // permissions:
        // - AMIN_KHEDMA/DEV can view any member that would appear in the members list for the selected family
        // - Others can only view members in their own family bucket
        boolean hasFamilySelection = family != null && !family.isBlank();
        boolean isKhadim = "KHADIM".equals(me.getRole());
        boolean khadimAttendanceContext = isKhadim && hasFamilySelection;

        String target = ((isAminKhedmaOrDev || khadimAttendanceContext) && hasFamilySelection)
                ? family
                : me.getDeaconFamily();
        String base = FamilyUtil.mainFamily(target);
        String uBase = FamilyUtil.mainFamily(u.getDeaconFamily());

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

        // DTO: don't return password
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
        return ResponseEntity.ok(dto);
    }


    /**
     * Delete a member account.
     * Allowed roles: AMIN_OSRA, AMIN_KHEDMA, DEVELOPER.
     * Notes:
     * - Cannot delete self.
     * - Cannot delete DEVELOPER accounts.
     * - AMIN_OSRA can delete MAKHDOM only within his own family.
     */
    @DeleteMapping("/members/{id}")
    public ResponseEntity<?> deleteMember(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String myRole = me.getRole();
        boolean isDev = "DEVELOPER".equals(myRole);
        boolean isAminKhedma = "AMIN_KHEDMA".equals(myRole);
        boolean isAminOsra = "AMIN_OSRA".equals(myRole);

        if (!(isDev || isAminKhedma || isAminOsra)) {
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

        // Delete dependent records first
        attendanceRepo.deleteByUserOrTakenBy(target.getId());

        userRepo.deleteById(target.getId());

        return ResponseEntity.ok(Map.of(
                "message", "User deleted",
                "userId", target.getId()
        ));
    }


    @PostMapping("/transfer-members")
    public ResponseEntity<?> transferMembers(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String myRole = me.getRole();
        boolean isDev = "DEVELOPER".equals(myRole);
        boolean isAminKhedma = "AMIN_KHEDMA".equals(myRole);
        boolean isAminOsra = "AMIN_OSRA".equals(myRole);

        if (!(isDev || isAminKhedma || isAminOsra)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        Object idsObj = body.get("memberIds");
        String newFamily = body.get("newFamily") == null ? null : body.get("newFamily").toString();
        String secondaryFamily = body.get("secondaryFamily") == null ? null : body.get("secondaryFamily").toString();
        Object extraFamiliesObj = body.get("extraFamilies");
        String targetRole = body.get("targetRole") == null ? null : body.get("targetRole").toString();
        String variant = body.get("variant") == null ? null : body.get("variant").toString(); // backward compatible
if (idsObj == null || newFamily == null || newFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "memberIds and newFamily are required");
        }

        List<Long> ids = new ArrayList<>();
        if (idsObj instanceof List<?> list) {
            for (Object o : list) {
                if (o == null) continue;
                ids.add(Long.valueOf(o.toString()));
            }
        }

        if (ids.isEmpty()) throw new ApiException(HttpStatus.BAD_REQUEST, "No members selected");

        // ✅ Optional: change role while transferring (only AMIN_KHEDMA/DEV)
        String normalizedTargetRole = null;
        if (targetRole != null && !targetRole.isBlank()) {
            if (isAminOsra) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
            normalizedTargetRole = targetRole.trim().toUpperCase(Locale.ROOT);

            // validate allowed roles
            List<String> allowed = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");
            if (!allowed.contains(normalizedTargetRole)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid targetRole");
            }
            if (!RoleUtil.canAssign(myRole, normalizedTargetRole)) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }


        
        // ✅ Registration family variants (special families)
        // NOTE: Stored family names may include prefixes like "اسره القس ...",
        // so we detect by keyword containment rather than exact match.
        List<String> specialKeywords = List.of("الانبا ابرام", "البابا كيرلس", "اسطفانوس");
        String newFamilyTrim = newFamily.trim();
        String targetBase = FamilyUtil.mainFamily(newFamilyTrim);
        boolean isSpecialTarget = (targetBase != null) && specialKeywords.stream().anyMatch(targetBase::contains);

        // ✅ effectiveFamily rules:
        // - Normal families: use base
        // - Special families:
        //    * if client sent full family with " أ"/" ب" -> accept as-is
        //    * else if client sent base only -> treat as SERVANT group (base)
        //    * variant is still accepted for backward compatibility
        String effectiveFamily;
        if (targetBase == null || targetBase.isBlank()) {
            effectiveFamily = newFamilyTrim;
        } else if (!isSpecialTarget) {
            effectiveFamily = targetBase;
        } else {
            // if already specified (A/B) keep it
            boolean alreadyAB = newFamilyTrim.matches(".*\s[أب]$");
            if (alreadyAB) {
                effectiveFamily = newFamilyTrim;
            } else if (variant != null && !variant.isBlank()) {
                String v = variant.trim().toUpperCase(Locale.ROOT);
                if ("A".equals(v)) effectiveFamily = targetBase + " أ";
                else if ("B".equals(v)) effectiveFamily = targetBase + " ب";
                else if ("SERVANT".equals(v)) effectiveFamily = targetBase;
                else throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid variant");
            } else {
                // base only => servant group
                effectiveFamily = targetBase;
            }
        }


        // ✅ Optional: extra serving families (future-proof)
        // Backward compatible:
        // - if client sends extraFamilies: use it
        // - else fall back to secondaryFamily
        List<String> requestedExtras = new ArrayList<>();
        if (extraFamiliesObj instanceof List<?> list) {
            for (Object o : list) {
                if (o == null) continue;
                String s = o.toString();
                if (s != null && !s.isBlank()) requestedExtras.add(s);
            }
        } else if (secondaryFamily != null && !secondaryFamily.isBlank()) {
            requestedExtras.add(secondaryFamily);
        }

        // normalize + cap to 3 extras (2..4)
        List<String> effectiveExtras = new ArrayList<>();
        for (String raw : requestedExtras) {
            if (raw == null || raw.isBlank()) continue;
            String secTrim = raw.trim();
            String secBase = FamilyUtil.mainFamily(secTrim);
            boolean isSpecialSec = (secBase != null) && specialKeywords.stream().anyMatch(secBase::contains);

            String normalized;
            if (secBase == null || secBase.isBlank()) {
                normalized = secTrim;
            } else if (!isSpecialSec) {
                normalized = secBase;
            } else {
                boolean alreadyAB2 = secTrim.matches(".*\\s[أب]$");
                if (alreadyAB2) normalized = secTrim;
                else if (variant != null && !variant.isBlank()) {
                    String v2 = variant.trim().toUpperCase(Locale.ROOT);
                    if ("A".equals(v2)) normalized = secBase + " أ";
                    else if ("B".equals(v2)) normalized = secBase + " ب";
                    else if ("SERVANT".equals(v2)) normalized = secBase;
                    else throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid variant");
                } else {
                    normalized = secBase;
                }
            }

            if (normalized != null && !normalized.isBlank()) {
                effectiveExtras.add(normalized.trim());
                if (effectiveExtras.size() >= 3) break;
            }
        }

if (effectiveFamily == null || effectiveFamily.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid target family");
        }
                if (targetBase == null || targetBase.isBlank() || "SYSTEM".equalsIgnoreCase(targetBase)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid target family");
        }

        // ✅ Validate extra families (if provided)
        for (String ef : effectiveExtras) {
            if (ef == null || ef.isBlank()) continue;
            String secBase = FamilyUtil.mainFamily(ef);
            if (secBase == null || secBase.isBlank() || "SYSTEM".equalsIgnoreCase(secBase)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid extra family");
            }
        }


        String myBase = FamilyUtil.mainFamily(me.getDeaconFamily());
        int updated = 0;
        for (Long id : ids) {
            if (id == null) continue;
            if (me.getId() != null && me.getId().equals(id)) continue; // never move self

            User u = userRepo.findById(id).orElse(null);
            if (u == null) continue;
            if ("DEVELOPER".equalsIgnoreCase(u.getRole())) continue;

            // ✅ AMIN_OSRA can move only accounts in his family
            if (isAminOsra) {
                String uBase = FamilyUtil.mainFamily(u.getDeaconFamily());
                if (myBase == null || !myBase.equals(uBase)) continue;
                // ✅ AMIN_OSRA can transfer only MAKHDOM (not KHADIM)
                if (!("MAKHDOM".equals(u.getRole()))) continue;
            }

            // ✅ AMIN_KHEDMA / DEV can move MAKHDOM / KHADIM / AMIN_OSRA / AMIN_KHEDMA
            if (isAminKhedma || isDev) {
                if (!("MAKHDOM".equals(u.getRole()) || "KHADIM".equals(u.getRole()) || "AMIN_OSRA".equals(u.getRole()) || "AMIN_KHEDMA".equals(u.getRole()))) {
                    continue;
                }
            }

            
            // ✅ Role handling
            // - If caller provided targetRole (AMIN_KHEDMA/DEV only): set it explicitly
            // - Else keep old behavior:
            //    * If moving to special-family SERVANT group OR the account was AMIN_KHEDMA/AMIN_OSRA -> downgrade to KHADIM
            boolean toServantGroup = (variant != null && "SERVANT".equalsIgnoreCase(variant.trim())) && isSpecialTarget;

            if (normalizedTargetRole != null) {
                u.setRole(normalizedTargetRole);
            } else {
                if (toServantGroup || "AMIN_KHEDMA".equals(u.getRole()) || "AMIN_OSRA".equals(u.getRole())) {
                    u.setRole("KHADIM");
                }
            }

            u.setDeaconFamily(effectiveFamily.trim());

            // ✅ Extra families rules:
            // - If extras are empty -> clear (2..4)
            // - If any extra equals primary base -> skip it
            // - Avoid duplicates between extras
            // - Store up to 3 extras in (2..4)
            String primBase = FamilyUtil.mainFamily(effectiveFamily);

            List<String> cleanExtras = new ArrayList<>();
            Set<String> seenBases = new LinkedHashSet<>();
            if (primBase != null && !primBase.isBlank()) seenBases.add(primBase);

            for (String ef : effectiveExtras) {
                if (ef == null || ef.isBlank()) continue;
                String eb = FamilyUtil.mainFamily(ef);
                if (eb == null || eb.isBlank()) continue;
                if (seenBases.stream().anyMatch(x -> x.equalsIgnoreCase(eb))) continue;
                seenBases.add(eb);
                cleanExtras.add(ef.trim());
                if (cleanExtras.size() >= 3) break;
            }

            u.setDeaconFamily2(cleanExtras.size() >= 1 ? cleanExtras.get(0) : null);
            u.setDeaconFamily3(cleanExtras.size() >= 2 ? cleanExtras.get(1) : null);
            u.setDeaconFamily4(cleanExtras.size() >= 3 ? cleanExtras.get(2) : null);

            // خليه ينقل للأسرة بالـ أ/ب لو موجودة  (u.setDeaconFamily(targetBase);)
            userRepo.save(u);
            updated++;

            // ✅ Reset attendance for roles below KHADIM (MAKHDOM only)
            if ("MAKHDOM".equals(u.getRole())) {
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
}
