package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AttendanceAccessGrant;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.AttendanceGrantKind;
import com.shmamsa.model.CustomFieldValue;
import com.shmamsa.model.CustomRegistrationField;
import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.model.FamilyRoleCode;
import com.shmamsa.model.User;
import com.shmamsa.model.UserFamilyAssignmentView;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.CustomFieldValueRepository;
import com.shmamsa.repository.CustomRegistrationFieldRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.service.AttendanceBackfillService;
import com.shmamsa.service.AttendanceAccessGrantService;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.FamilyCatalogService;
import com.shmamsa.service.KhorsJoinRequestService;
import com.shmamsa.service.UserFamilyRoleService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.*;

@RestController
@RequestMapping("/api/family")
@RequiredArgsConstructor
public class  FamilyController {

    private final UserRepository userRepo;
    private final AttendanceRepository attendanceRepo;
    private final KhorsJoinRequestService khorsReqService;
    private final AttendanceBackfillService attendanceBackfillService;
    private final AttendanceAccessGrantService attendanceAccessGrantService;
    private final FamilyAccessService familyAccessService;
    private final FamilyCatalogService familyCatalogService;
    private final UserFamilyRoleService userFamilyRoleService;
    private final CustomRegistrationFieldRepository customFieldRepo;
    private final CustomFieldValueRepository customFieldValueRepo;

    private String baseFamilyOf(User u) {
        return familyAccessService.baseFamily(u);
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

    private boolean hasScopedRole(User user, String wantedRole) {
        if (user == null || wantedRole == null || wantedRole.isBlank()) return false;
        return userFamilyRoleService.getAssignments(user).stream()
                .map(UserFamilyAssignmentView::getRole)
                .map(FamilyController::normRole)
                .anyMatch(wantedRole::equals);
    }

    private boolean hasAminOsraPrivilege(User user) {
        return user != null
                && ("AMIN_OSRA".equals(normRole(user.getRole())) || hasScopedRole(user, "AMIN_OSRA"));
    }

    private boolean hasAminKhedmaPrivilege(User user) {
        return user != null
                && ("AMIN_KHEDMA".equals(normRole(user.getRole())) || hasScopedRole(user, "AMIN_KHEDMA"));
    }

    private List<String> aminOsraScopeBases(User user) {
        if (!hasAminOsraPrivilege(user)) return List.of();

        LinkedHashSet<String> out = userFamilyRoleService.getAssignments(user).stream()
                .filter(Objects::nonNull)
                .filter(assignment -> "AMIN_OSRA".equals(normRole(assignment.getRole())))
                .map(assignment -> familyAccessService.baseNameForId(assignment.getFamilyId(), assignment.getFamilyName()))
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(x -> !x.isBlank())
                .collect(java.util.stream.Collectors.toCollection(LinkedHashSet::new));

        if (!out.isEmpty()) return new ArrayList<>(out);

        List<String> fallback = memberBasesOf(user);
        if (!fallback.isEmpty()) return fallback;

        String base = baseFamilyOf(user);
        if (base != null && !base.isBlank()) return List.of(base);
        return List.of();
    }

    private boolean hasAminOsraScopeForFamily(User user, String family) {
        String selectedBase = looseBaseNameForName(family);
        if (selectedBase == null || selectedBase.isBlank()) return false;
        return aminOsraScopeBases(user).stream().anyMatch(base -> base.equalsIgnoreCase(selectedBase));
    }

    private List<String> servingBasesOf(User u) {
        return familyAccessService.servingBasesOf(u);
    }

    private String normalizeArabicFamilyKey(String value) {
        return String.valueOf(value == null ? "" : value)
                .replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .replace("أ", "ا")
                .replace("إ", "ا")
                .replace("آ", "ا")
                .replace("ة", "ه")
                .replaceAll("\\s+", " ")
                .trim()
                .toLowerCase(Locale.ROOT);
    }

    private String looseBaseNameForName(String familyName) {
        String raw = String.valueOf(familyName == null ? "" : familyName).trim();
        if (raw.isBlank()) return null;

        // familyCatalogService.baseNameForName(raw) returns raw again when it cannot
        // find the value in the catalog. Do not stop there, because the attendance UI
        // sometimes sends short labels such as "البابا كيرلس" while the catalog stores
        // "اسرة القديس البابا كيرلس".
        FamilyCatalog exact = familyCatalogService.findByName(raw);
        if (exact != null) {
            String direct = familyCatalogService.baseNameForName(raw);
            if (direct != null && !direct.isBlank()) return direct.trim();
        }

        String wanted = normalizeArabicFamilyKey(raw);
        for (String candidate : familyCatalogService.listSelectableBaseNames()) {
            String key = normalizeArabicFamilyKey(candidate);
            if (key.equals(wanted) || key.contains(wanted) || wanted.contains(key)) {
                return familyCatalogService.baseNameForName(candidate);
            }
        }

        // Common UI display values are shortened, for example "البابا كيرلس".
        String withoutPrefixes = wanted
                .replace("اسره ", "")
                .replace("القديس ", "")
                .replace("الانبا ", "")
                .trim();
        for (String candidate : familyCatalogService.listSelectableBaseNames()) {
            String key = normalizeArabicFamilyKey(candidate)
                    .replace("اسره ", "")
                    .replace("القديس ", "")
                    .replace("الانبا ", "")
                    .trim();
            if (key.equals(withoutPrefixes) || key.contains(withoutPrefixes) || withoutPrefixes.contains(key)) {
                return familyCatalogService.baseNameForName(candidate);
            }
        }

        return raw;
    }

    private List<Long> relatedFamilyIds(String familyName) {
        String base = looseBaseNameForName(familyName);
        if (base == null || base.isBlank()) return List.of();
        return familyCatalogService.relatedIdsForSelection(base);
    }

    private String normalizedBaseKey(String familyName) {
        String base = looseBaseNameForName(familyName);
        if (base == null || base.isBlank()) base = String.valueOf(familyName == null ? "" : familyName).trim();
        return normalizeArabicFamilyKey(base);
    }

    private boolean sameFamilyBaseLoose(String a, String b) {
        String ak = normalizedBaseKey(a);
        String bk = normalizedBaseKey(b);
        return !ak.isBlank() && !bk.isBlank() && ak.equals(bk);
    }

    private boolean isDeveloperUser(User u) {
        return "DEVELOPER".equalsIgnoreCase(normRole(u == null ? null : u.getRole()))
                || "DEV".equalsIgnoreCase(normRole(u == null ? null : u.getRole()));
    }

    private String roleForSelectedFamily(User u, String base) {
        String scoped = (base == null || base.isBlank()) ? null : familyAccessService.scopedRole(u, base);
        return (scoped == null || scoped.isBlank()) ? u.getRole() : scoped;
    }

    private List<User> attendanceUsersForFamily(String base, List<String> roleFallback) {
        if (base == null || base.isBlank()) return List.of();

        List<User> users;
        if (isChoirBucket(base)) {
            String code = choirCodeFromBucket(base);
            if (code == null || code.isBlank()) return List.of();

            Map<Long, User> map = new LinkedHashMap<>();
            for (User u : userRepo.findByKhorsAndRoleIn(code, roleFallback)) {
                if (u != null && u.getId() != null) map.put(u.getId(), u);
            }
            for (User u : userRepo.findByAttendKhorsAndRoleIn(code, roleFallback)) {
                if (u != null && u.getId() != null) map.put(u.getId(), u);
            }
            users = new ArrayList<>(map.values());
        } else {
            List<Long> ids = relatedFamilyIds(base);
            users = ids.isEmpty() ? List.of() : userRepo.findByAnyFamilyIdIn(ids);
        }

        return users.stream()
                .filter(Objects::nonNull)
                .filter(u -> u.getId() != null)
                .filter(u -> !isDeveloperUser(u))
                .toList();
    }

    private List<String> grantFamilyList(String familyBase) {
        String raw = String.valueOf(familyBase == null ? "" : familyBase).trim();
        if (raw.isBlank() || "ALL".equalsIgnoreCase(raw)) return List.of();

        return Arrays.stream(raw.split("[,،;|]+"))
                .map(String::trim)
                .filter(x -> !x.isBlank())
                .map(this::looseBaseNameForName)
                .filter(Objects::nonNull)
                .filter(x -> !x.isBlank())
                .distinct()
                .toList();
    }

    private boolean grantFamilyMatches(String grantFamilyBase, String selectedFamily) {
        String selectedBase = looseBaseNameForName(selectedFamily);
        List<String> grantFamilies = grantFamilyList(grantFamilyBase);
        if (grantFamilies.isEmpty()) return true;
        if (selectedBase == null || selectedBase.isBlank()) return false;
        return grantFamilies.stream().anyMatch(x -> sameFamilyBaseLoose(x, selectedBase));
    }

    private List<AttendanceAccessGrant> visibleGrantsForKind(User user, AttendanceGrantKind kind) {
        if (user == null || user.getId() == null || kind == null) return List.of();
        return attendanceAccessGrantService.visibleGrantsForUser(user.getId()).stream()
                .filter(g -> g.getGrantKind() == kind)
                .toList();
    }

    private boolean attendanceGrantAllowsSelectedFamily(User user, String selectedFamily, AttendanceGrantKind kind) {
        String selectedBase = looseBaseNameForName(selectedFamily);
        if (selectedBase == null || selectedBase.isBlank()) return false;
        return visibleGrantsForKind(user, kind).stream()
                .anyMatch(g -> grantFamilyMatches(g.getFamilyBase(), selectedBase));
    }

    private boolean takeAttendanceGrantAllowsSelectedFamily(User user, String selectedFamily) {
        return attendanceGrantAllowsSelectedFamily(user, selectedFamily, AttendanceGrantKind.TAKE_ATTENDANCE);
    }

    private List<String> visibleTakeAttendanceGrantFamilies(User user) {
        List<AttendanceAccessGrant> grants = visibleGrantsForKind(user, AttendanceGrantKind.TAKE_ATTENDANCE);
        if (grants.isEmpty()) return List.of();

        // Empty/ALL family scope means the grant is intentionally open for all selectable bases.
        if (grants.stream().anyMatch(g -> grantFamilyList(g.getFamilyBase()).isEmpty())) {
            return familyCatalogService.listSelectableBaseNames();
        }

        return grants.stream()
                .flatMap(g -> grantFamilyList(g.getFamilyBase()).stream())
                .filter(Objects::nonNull)
                .map(String::trim)
                .filter(x -> !x.isBlank())
                .distinct()
                .toList();
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
        boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role) || hasAminKhedmaPrivilege(me);
        boolean isKhadim = "KHADIM".equals(role);
        boolean isAminOsra = "AMIN_OSRA".equals(role) || hasAminOsraPrivilege(me);
        boolean attendanceContext = context != null && "attendance".equalsIgnoreCase(context.trim());

        if (attendanceContext && me != null && !isAminKhedmaOrDev && !isKhadim && !isAminOsra) {
            List<String> grantFamilies = visibleTakeAttendanceGrantFamilies(me);
            return ResponseEntity.ok(grantFamilies);
        }

        if (attendanceContext && me != null && isAminOsra && !isAminKhedmaOrDev) {
            List<String> out = new ArrayList<>(aminOsraScopeBases(me));
            out.sort(String::compareTo);
            return ResponseEntity.ok(out);
        }

        if (isKhadim && !attendanceContext) {
            List<String> out = servingBasesOf(me);
            out.sort(String::compareTo);
            return ResponseEntity.ok(out);
        }

        return ResponseEntity.ok(familyCatalogService.listSelectableBaseNames());
    }


    private List<Map<String, Object>> toMemberRows(List<User> members, User me, boolean includeSelf, String base) {
        List<Map<String, Object>> out = new ArrayList<>();
        for (User u : members == null ? List.<User>of() : members) {
            if (u == null || u.getId() == null) continue;
            if (!includeSelf && me != null && me.getId() != null && me.getId().equals(u.getId())) continue;

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", u.getId());
            row.put("fullName", u.getFullName());
            row.put("role", roleForSelectedFamily(u, base));
            row.put("deaconFamily", familyAccessService.primaryFamilyName(u));
            row.put("deaconFamily2", familyAccessService.secondaryFamilyName(u));
            row.put("deaconFamily3", familyAccessService.thirdFamilyName(u));
            row.put("deaconFamily4", familyAccessService.fourthFamilyName(u));
            row.put("deaconFamilyRole", familyAccessService.primaryFamilyRole(u));
            row.put("deaconFamilyRole2", familyAccessService.secondaryFamilyRole(u));
            row.put("deaconFamilyRole3", familyAccessService.thirdFamilyRole(u));
            row.put("deaconFamilyRole4", familyAccessService.fourthFamilyRole(u));
            row.put("familyAssignments", userFamilyRoleService.getAssignments(u));
            out.add(row);
        }
        return out;
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
        boolean isAminKhedmaOrDev = "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role) || hasAminKhedmaPrivilege(me);
        boolean isAminOsra = "AMIN_OSRA".equals(role) || hasAminOsraPrivilege(me);
        boolean isKhadim = "KHADIM".equals(role);

        boolean servantsBucket = isAminKhedmaOrDev && family != null && "SERVANTS".equalsIgnoreCase(family.trim());


        boolean hasFamilySelection = family != null && !family.isBlank();

        String effectiveRole = hasFamilySelection ? effectiveRoleIn(me, family) : role;
        boolean aminOsraScopeForSelectedFamily = hasFamilySelection && hasAminOsraScopeForFamily(me, family);
        boolean effIsAminOsra = aminOsraScopeForSelectedFamily || (!hasFamilySelection && isAminOsra);

        boolean attendanceContext = context != null && "attendance".equalsIgnoreCase(context.trim());
        boolean hasTakeAttendanceGrant = attendanceContext && attendanceAccessGrantService.hasVisibleGrant(me.getId(), AttendanceGrantKind.TAKE_ATTENDANCE);
        boolean hasSelfAttendanceGrant = attendanceContext && attendanceAccessGrantService.hasVisibleGrant(me.getId(), AttendanceGrantKind.SELF_CHECKIN);
        boolean hasAnyAttendanceGrant = hasTakeAttendanceGrant || hasSelfAttendanceGrant;
        boolean grantSelectedContext = attendanceContext && hasFamilySelection && takeAttendanceGrantAllowsSelectedFamily(me, family);
        boolean delegatedTakeAttendanceContext = attendanceContext && hasFamilySelection && hasTakeAttendanceGrant && takeAttendanceGrantAllowsSelectedFamily(me, family);
        boolean aminOsraAttendanceContext = effIsAminOsra && hasFamilySelection && attendanceContext;

        if (attendanceContext && hasFamilySelection && isAminOsra && !isAminKhedmaOrDev && !aminOsraScopeForSelectedFamily && !grantSelectedContext) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        if (isKhadim && hasFamilySelection && !attendanceContext) {
            String selectedBase = looseBaseNameForName(family);
            List<String> myBases = servingBasesOf(me);
            if (selectedBase == null || myBases.stream().noneMatch(b -> b.equalsIgnoreCase(selectedBase))) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        boolean khadimSelectedContext = isKhadim && hasFamilySelection;

        boolean canSelectFamily = isAminKhedmaOrDev || khadimSelectedContext || aminOsraAttendanceContext || effIsAminOsra || grantSelectedContext || delegatedTakeAttendanceContext;

        // Attendance grants for normal members should behave like a delegated attendance page:
        // allow loading the selected family members (makhdomeen + servants + family leaders)
        // only when the selected family is covered by the grant scope.
        if (delegatedTakeAttendanceContext && !isAminKhedmaOrDev && !isKhadim && !effIsAminOsra) {
            String grantBase = looseBaseNameForName(family);
            List<String> allRoles = expandRoles(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"));
            List<User> grantMembers = attendanceUsersForFamily(grantBase, allRoles);
            return ResponseEntity.ok(toMemberRows(grantMembers, me, includeSelf, grantBase));
        }

        String target = (canSelectFamily && hasFamilySelection)
                ? family
                : baseFamilyOf(me);
        String base = servantsBucket ? null : looseBaseNameForName(target);

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
            rolesToShow = hasAnyAttendanceGrant
                    ? expandRoles(List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA"))
                    : expandRoles(List.of("MAKHDOM"));
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
                List<Long> ids = relatedFamilyIds(b);
                for (User u : userRepo.findByAnyFamilyIdInAndRoleIn(ids, rolesToShow)) {
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
                List<Long> ids = relatedFamilyIds(base);
                boolean useAssignmentRoles = attendanceContext
                        && (isAminKhedmaOrDev || isKhadim || effIsAminOsra || hasAnyAttendanceGrant);
                members = ids.isEmpty()
                        ? List.of()
                        : (useAssignmentRoles
                        ? attendanceUsersForFamily(base, rolesToShow)
                        : userRepo.findByAnyFamilyIdInAndRoleIn(ids, rolesToShow));
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
            boolean includeSensitive = canViewSensitiveMemberDetails(me, u);

            long fridayTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeehaTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.TASBEEHA);
            Long baseFamilyId = base == null || base.isBlank() || isChoirBucket(base) ? null : familyAccessService.familyIdForName(base);
            long meetingTotal;
            if (baseFamilyId != null) {
                meetingTotal = attendanceRepo.countByUser_IdAndTypeAndFamilyIdAndArchivedFalse(u.getId(), AttendanceType.FAMILY_MEETING, baseFamilyId);
            } else {
                String primFam = familyAccessService.primaryFamilyName(u);
                Long primFamId = primFam != null ? familyAccessService.familyIdForName(primFam.trim()) : null;
                meetingTotal = primFamId != null
                        ? attendanceRepo.countByUser_IdAndTypeAndFamilyIdAndArchivedFalse(u.getId(), AttendanceType.FAMILY_MEETING, primFamId)
                        : 0;
            }

            // ✅ Choir totals (only meaningful for choir members)
            long marmarkosTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.MARMARKOS_KHORS);
            long athanasiusTotal = attendanceRepo.countByUser_IdAndTypeAndArchivedFalse(u.getId(), AttendanceType.ATHANASIUS_KHORS);

            long fridayPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.FRIDAY_LITURGY);
            long tasbeehaPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.TASBEEHA);
            long meetingPresent;
            if (baseFamilyId != null) {
                meetingPresent = attendanceRepo.countPresentByUserAndTypeAndFamilyIdActive(u.getId(), AttendanceType.FAMILY_MEETING, baseFamilyId);
            } else {
                String primFam = familyAccessService.primaryFamilyName(u);
                Long primFamId = primFam != null ? familyAccessService.familyIdForName(primFam.trim()) : null;
                meetingPresent = primFamId != null
                        ? attendanceRepo.countPresentByUserAndTypeAndFamilyIdActive(u.getId(), AttendanceType.FAMILY_MEETING, primFamId)
                        : 0;
            }

            long marmarkosPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.MARMARKOS_KHORS);
            long athanasiusPresent = attendanceRepo.countPresentByUserAndTypeActive(u.getId(), AttendanceType.ATHANASIUS_KHORS);

            Map<String, Object> row = new LinkedHashMap<>();
            row.put("id", u.getId());
            row.put("fullName", u.getFullName());
            row.put("role", roleForSelectedFamily(u, base));
            row.put("deaconFamily", familyAccessService.primaryFamilyName(u));
            row.put("deaconFamily2", familyAccessService.secondaryFamilyName(u));
            row.put("deaconFamily3", familyAccessService.thirdFamilyName(u));
            row.put("deaconFamily4", familyAccessService.fourthFamilyName(u));
            row.put("deaconFamilyRole", familyAccessService.primaryFamilyRole(u));
            row.put("deaconFamilyRole2", familyAccessService.secondaryFamilyRole(u));
            row.put("deaconFamilyRole3", familyAccessService.thirdFamilyRole(u));
            row.put("deaconFamilyRole4", familyAccessService.fourthFamilyRole(u));
            row.put("familyAssignments", userFamilyRoleService.getAssignments(u));
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
            row.put("schoolGrade", u.getSchoolGrade());
            if (includeSensitive) {
                row.put("phoneNumber", u.getPhoneNumber());
                row.put("guardiansPhone", u.getGuardiansPhone());
                row.put("dateOfBirth", u.getDateOfBirth());
                row.put("address", u.getAddress());
            }
            appendCustomFieldValues(row, u, "IFTEKAD");
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
                : baseFamilyOf(me);
        String base = familyCatalogService.baseNameForName(target);
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

        boolean includeSensitive = canViewSensitiveMemberDetails(me, u);
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", u.getId());
        dto.put("fullName", u.getFullName());
        dto.put("username", u.getUsername());
        dto.put("email", u.getEmail());
        dto.put("role", u.getRole());
        dto.put("deaconFamily", familyAccessService.primaryFamilyName(u));
        dto.put("deaconFamily2", familyAccessService.secondaryFamilyName(u));
        dto.put("deaconFamily3", familyAccessService.thirdFamilyName(u));
        dto.put("deaconFamily4", familyAccessService.fourthFamilyName(u));
        dto.put("deaconFamilyRole", familyAccessService.primaryFamilyRole(u));
        dto.put("deaconFamilyRole2", familyAccessService.secondaryFamilyRole(u));
        dto.put("deaconFamilyRole3", familyAccessService.thirdFamilyRole(u));
        dto.put("deaconFamilyRole4", familyAccessService.fourthFamilyRole(u));
        dto.put("familyAssignments", userFamilyRoleService.getAssignments(u));
        dto.put("deaconDegree", u.getDeaconDegree());
        dto.put("phoneNumber", u.getPhoneNumber());
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
        if (includeSensitive) {
            dto.put("nationalId", u.getNationalId());
            dto.put("address", u.getAddress());
            dto.put("guardiansPhone", u.getGuardiansPhone());
            dto.put("guardianRelation", u.getGuardianRelation());
            dto.put("dateOfBirth", u.getDateOfBirth());
            dto.put("gender", u.getGender());
        }
        appendCustomFieldValues(dto, u, "FAMILY_INFO");
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
        userFamilyRoleService.deleteAssignments(target);

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
        String transferFamilyBase = familyCatalogService.baseNameForName(transferFamily);
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
            String rawTargetRole = targetRole.trim().toUpperCase(Locale.ROOT);

            if (isAminOsra || scopedAminOsra) {
                // AMIN_OSRA can only pass through the member's existing role (no actual change)
                if (!"MAKHDOM".equals(rawTargetRole)) {
                    throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
                }
            } else {
                List<String> allowed = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");
                if (!allowed.contains(rawTargetRole)) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid targetRole");
                }
                if (!RoleUtil.canAssign(myRole, rawTargetRole)) {
                    throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
                }
            }
            normalizedTargetRole = rawTargetRole;
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
        String targetBase = familyCatalogService.baseNameForName(newFamilyTrim);
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
            String secBase = familyCatalogService.baseNameForName(secTrim);
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
            String secBase = familyCatalogService.baseNameForName(ef);
            if (secBase == null || secBase.isBlank() || "SYSTEM".equalsIgnoreCase(secBase)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid extra family");
            }
            String extraRole = normRole(extra.get("role"));
            if (!List.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "MAKHDOM").contains(extraRole)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid extra family role");
            }
        }

        String myBase = familyAccessService.baseFamily(me);
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

            String primBase = familyCatalogService.baseNameForName(effectiveFamily);

            List<Map<String, String>> cleanExtras = new ArrayList<>();
            Set<String> seenBases = new LinkedHashSet<>();
            if (primBase != null && !primBase.isBlank()) seenBases.add(primBase);

            for (Map<String, String> extra : effectiveExtras) {
                String ef = extra.get("family");
                if (ef == null || ef.isBlank()) continue;
                String eb = familyCatalogService.baseNameForName(ef);
                if (eb == null || eb.isBlank()) continue;
                if (seenBases.stream().anyMatch(x -> x.equalsIgnoreCase(eb))) continue;
                seenBases.add(eb);
                cleanExtras.add(Map.of(
                        "family", ef.trim(),
                        "role", normRole(extra.get("role"))
                ));
                if (cleanExtras.size() >= 3) break;
            }

            List<UserFamilyAssignmentView> newAssignments = new ArrayList<>();
            String primaryRole = normalizedTargetRole != null ? normalizedTargetRole : normRole(u.getRole());
            newAssignments.add(UserFamilyAssignmentView.builder()
                    .familyId(familyIdByName(effectiveFamily.trim()))
                    .familyName(effectiveFamily.trim())
                    .roleCode(FamilyRoleCode.fromRole(primaryRole).getCode())
                    .role(FamilyRoleCode.fromRole(primaryRole).getRoleName())
                    .assignmentOrder(1)
                    .build());
            for (int i = 0; i < cleanExtras.size(); i++) {
                Map<String, String> extra = cleanExtras.get(i);
                String extraRole = normRole(extra.get("role"));
                newAssignments.add(UserFamilyAssignmentView.builder()
                        .familyId(familyIdByName(extra.get("family")))
                        .familyName(extra.get("family"))
                        .roleCode(FamilyRoleCode.fromRole(extraRole).getCode())
                        .role(FamilyRoleCode.fromRole(extraRole).getRoleName())
                        .assignmentOrder(i + 2)
                        .build());
            }

            userFamilyRoleService.replaceAssignments(u, newAssignments);
            userRepo.save(u);
            attendanceBackfillService.backfillForUser(u);
            updated++;

            if ("MAKHDOM".equalsIgnoreCase(u.getRole())) {
                attendanceRepo.deleteByUserId(u.getId());
            }
        }

        return ResponseEntity.ok(Map.of("updated", updated));
    }

    @PostMapping("/remove-assignment")
    public ResponseEntity<?> removeAssignment(@RequestBody Map<String, Object> body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String myRole = normRole(me.getRole());
        if (!List.of("AMIN_KHEDMA", "DEVELOPER").contains(myRole)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        Object memberIdObj = body.get("memberId");
        String family = body.get("family") == null ? null : body.get("family").toString().trim();

        if (memberIdObj == null || family == null || family.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "memberId and family are required");
        }

        Long memberId = Long.valueOf(memberIdObj.toString());
        User u = userRepo.findById(memberId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Member not found"));

        if ("DEVELOPER".equalsIgnoreCase(u.getRole())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        boolean removeAll = "ALL".equalsIgnoreCase(family);
        String targetBase = removeAll ? null : familyCatalogService.baseNameForName(family);
        if (!removeAll && (targetBase == null || targetBase.isBlank())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Unknown family");
        }

        List<UserFamilyAssignmentView> current = userFamilyRoleService.getAssignments(u);
        List<UserFamilyAssignmentView> filtered = new ArrayList<>();
        boolean removed = false;

        if (removeAll) {
            // Remove all family assignments — servant stays as role but unassigned
            removed = !current.isEmpty();
        } else {
            int order = 1;
            for (UserFamilyAssignmentView a : current) {
                String aBase = familyCatalogService.baseNameForName(a.getFamilyName());
                if (!removed && targetBase.equalsIgnoreCase(aBase)) {
                    removed = true;
                    continue;
                }
                filtered.add(UserFamilyAssignmentView.builder()
                        .familyId(a.getFamilyId())
                        .familyName(a.getFamilyName())
                        .roleCode(a.getRoleCode())
                        .role(a.getRole())
                        .assignmentOrder(order++)
                        .build());
            }
        }

        if (!removed) {
            return ResponseEntity.ok(Map.of("updated", 0, "note", "Assignment not found"));
        }

        userFamilyRoleService.replaceAssignments(u, filtered);
        userRepo.saveAndFlush(u);
        attendanceBackfillService.backfillForUser(u);

        return ResponseEntity.ok(Map.of("updated", 1));
    }

    @GetMapping("/members/{id}/attendance")
    public ResponseEntity<?> memberAttendance(@PathVariable Long id,
                                              @RequestParam(required = false) AttendanceType type,
                                              Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
        User member = userRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Member not found"));

        if (!canViewMemberAttendance(me, member)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

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
            row.put("customTitle", r.getCustomTitle());

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
        for (UserFamilyAssignmentView assignment : userFamilyRoleService.getAssignments(u)) {
            String f = assignment.getFamilyName();
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
        String base = familyCatalogService.baseNameForName(family);
        if (base == null || base.isBlank()) return normRole(me.getRole());
        String scoped = familyAccessService.scopedRole(me, base);
        if (scoped != null && !scoped.isBlank()) return normRole(scoped);
        return normRole(me.getRole());
    }

    private String familyBaseMatch(User user, String familyBase) {
        if (user == null || familyBase == null || familyBase.isBlank()) return null;
        String base = familyCatalogService.baseNameForName(familyBase);
        for (UserFamilyAssignmentView assignment : userFamilyRoleService.getAssignments(user)) {
            String candidate = familyAccessService.baseNameForId(assignment.getFamilyId(), assignment.getFamilyName());
            if (base.equalsIgnoreCase(candidate)) return base;
        }
        return null;
    }

    private List<String> memberBasesOf(User user) {
        Set<String> bases = new LinkedHashSet<>();
        for (UserFamilyAssignmentView assignment : userFamilyRoleService.getAssignments(user)) {
            String candidate = familyAccessService.baseNameForId(assignment.getFamilyId(), assignment.getFamilyName());
            if (candidate != null && !candidate.isBlank()) {
                bases.add(candidate);
            }
        }
        return new ArrayList<>(bases);
    }

    private boolean sharesChoirScope(User actor, User member) {
        String actorRole = normRole(actor == null ? null : actor.getRole());
        if (!"KHADIM".equals(actorRole)) return false;

        String scope = String.valueOf(actor.getServingScope() == null ? "" : actor.getServingScope()).trim().toUpperCase(Locale.ROOT);
        if (!("KHORS_ONLY".equals(scope) || "BOTH".equals(scope))) return false;

        String actorKhors = String.valueOf(actor.getKhors() == null ? "" : actor.getKhors()).trim().toUpperCase(Locale.ROOT);
        String memberKhors = String.valueOf(member.getKhors() == null ? "" : member.getKhors()).trim().toUpperCase(Locale.ROOT);
        String memberAttendKhors = String.valueOf(member.getAttendKhors() == null ? "" : member.getAttendKhors()).trim().toUpperCase(Locale.ROOT);

        if ("BOTH".equals(actorKhors)) {
            return "MARMARKOS".equals(memberKhors) || "ATHANASIUS".equals(memberKhors)
                    || "MARMARKOS".equals(memberAttendKhors) || "ATHANASIUS".equals(memberAttendKhors)
                    || "BOTH".equals(memberKhors) || "BOTH".equals(memberAttendKhors);
        }
        return actorKhors.equals(memberKhors) || actorKhors.equals(memberAttendKhors);
    }

    private boolean canViewMemberAttendance(User actor, User member) {
        if (actor == null || member == null) return false;
        if (actor.getId() != null && actor.getId().equals(member.getId())) return true;

        String actorRole = normRole(actor.getRole());
        if ("DEVELOPER".equals(actorRole) || "AMIN_KHEDMA".equals(actorRole)) return true;

        List<String> actorBases = servingBasesOf(actor);
        List<String> memberBases = memberBasesOf(member);
        for (String actorBase : actorBases) {
            for (String memberBase : memberBases) {
                if (actorBase != null && actorBase.equalsIgnoreCase(memberBase)) {
                    return true;
                }
            }
        }

        return sharesChoirScope(actor, member);
    }

    private boolean canViewSensitiveMemberDetails(User actor, User member) {
        if (actor == null || member == null) return false;
        if (actor.getId() != null && actor.getId().equals(member.getId())) return true;

        String actorRole = normRole(actor.getRole());
        if ("DEVELOPER".equals(actorRole) || "AMIN_KHEDMA".equals(actorRole)) return true;
        if (!"AMIN_OSRA".equals(actorRole)) return false;

        List<String> actorBases = servingBasesOf(actor);
        List<String> memberBases = memberBasesOf(member);
        for (String actorBase : actorBases) {
            for (String memberBase : memberBases) {
                if (actorBase != null && actorBase.equalsIgnoreCase(memberBase)) {
                    return true;
                }
            }
        }
        return false;
    }

    private void appendCustomFieldValues(Map<String, Object> dto, User user, String target) {
        if (dto == null || user == null || user.getId() == null) {
            return;
        }

        List<CustomRegistrationField> visibleFields = customFieldRepo.findAllByEnabledTrueOrderByDisplayOrderAsc().stream()
                .filter(field -> showInContains(field.getShowIn(), target))
                .toList();

        if (visibleFields.isEmpty()) {
            return;
        }

        Map<String, String> valuesByKey = new LinkedHashMap<>();
        for (CustomFieldValue value : customFieldValueRepo.findAllByUserId(user.getId())) {
            String key = value.getFieldKey();
            if (key == null || key.isBlank()) {
                continue;
            }
            valuesByKey.put(key, value.getValue());
        }

        Map<String, String> visibleValues = new LinkedHashMap<>();
        for (CustomRegistrationField field : visibleFields) {
            String value = valuesByKey.get(field.getFieldKey());
            if (value == null || value.isBlank()) {
                continue;
            }
            visibleValues.put(field.getFieldKey(), value.trim());
        }

        if (!visibleValues.isEmpty()) {
            dto.put("customFields", visibleValues);
        }
    }

    private boolean showInContains(String showIn, String target) {
        if (target == null || target.isBlank() || showIn == null || showIn.isBlank()) {
            return false;
        }

        String normalizedTarget = target.trim().toUpperCase(Locale.ROOT);
        for (String rawPart : showIn.split(",")) {
            String normalized = rawPart == null ? "" : rawPart.trim().toUpperCase(Locale.ROOT);
            if (normalizedTarget.equals(normalized)) {
                return true;
            }
        }

        return false;
    }

    private Long familyIdByName(String name) {
        FamilyCatalog family = familyCatalogService.findByName(name);
        return family == null ? null : family.getId();
    }

}
