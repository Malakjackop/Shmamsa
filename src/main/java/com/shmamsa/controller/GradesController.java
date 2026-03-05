package com.shmamsa.controller;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.GradeSheet;
import com.shmamsa.model.User;
import com.shmamsa.repository.GradeSheetRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import com.shmamsa.util.FamilyUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDateTime;
import java.util.*;

@RestController
@RequestMapping("/api/grades")
@RequiredArgsConstructor
public class GradesController {

    private final UserRepository userRepo;
    private final GradeSheetRepository gradeRepo;
    private final ObjectMapper mapper = new ObjectMapper();

    // ----- DTOs -----
    public record Column(String id, String title) {}
    public record SheetPayload(List<Column> columns, Map<String, Map<String, String>> rows) {} 
    // rows: userId -> {colId -> value}

    public record SheetView(
            String familyBase,
            String status,
            LocalDateTime updatedAt,
            LocalDateTime publishedAt,
            List<Column> columns,
            List<Map<String, Object>> members
    ) {}

    public record MyGradesView(
            String familyBase,
            LocalDateTime publishedAt,
            List<Column> columns,
            Map<String, String> values
    ) {}

    // ----- Helpers -----
    private String normRole(String raw) {
        if (raw == null) return "MAKHDOM";
        String r = raw.trim().replace("ROLE_", "");
        String upper = r.toUpperCase().replaceAll("[-\\s]+", "_");

        String ar = r.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .trim()
                .replaceAll("\\s+", " ");

        if (ar.equals("مخدوم")) return "MAKHDOM";
        if (ar.equals("خادم")) return "KHADIM";
        if (ar.equals("امين اسرة") || ar.equals("أمين أسرة") || ar.equals("امين الاسرة") || ar.equals("أمين الاسره") || ar.equals("امين الأسرة")) return "AMIN_OSRA";
        if (ar.equals("امين خدمة") || ar.equals("أمين خدمة") || ar.equals("امين الخدمه") || ar.equals("أمين الخدمه")) return "AMIN_KHEDMA";

        return upper.isBlank() ? "MAKHDOM" : upper;
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
        return new ArrayList<>(set);
    }

    private String effectiveRoleIn(User me, String familyBase) {
        if (me == null) return "MAKHDOM";
        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null || base.isBlank()) return normRole(me.getRole());

        String scoped = me.roleForFamilyBase(base);
        if (scoped != null && !scoped.isBlank()) return normRole(scoped);

        // ✅ Important: if user serves this family but has a global AMIN_OSRA (legacy/global role),
        // treat them as KHADIM in families where they don't have AMIN_OSRA scoped.
        String global = normRole(me.getRole());
        if ("AMIN_OSRA".equals(global)) {
            List<String> my = servingBasesOf(me);
            if (my.stream().anyMatch(b -> b.equalsIgnoreCase(base))) {
                return "KHADIM";
            }
        }

        return global;
    }

private void ensureCanViewSheet(User me, String familyBase) {
        String global = normRole(me.getRole());
        if ("AMIN_KHEDMA".equals(global) || "DEVELOPER".equals(global)) return;

        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        String eff = effectiveRoleIn(me, base);

        if ("KHADIM".equals(eff)) {
            List<String> my = servingBasesOf(me);
            if (my.stream().noneMatch(b -> b.equalsIgnoreCase(base))) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
            return;
        }

        if ("AMIN_OSRA".equals(eff)) {
            // allowed only where scoped role is AMIN_OSRA
            String scoped = me.roleForFamilyBase(base);
            if (scoped == null || !"AMIN_OSRA".equalsIgnoreCase(normRole(scoped))) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
            return;
        }

        throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
    }

    private void ensureCanEditSheet(User me, String familyBase) {
        String global = normRole(me.getRole());
        if ("AMIN_KHEDMA".equals(global) || "DEVELOPER".equals(global)) return;

        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        String eff = effectiveRoleIn(me, base);
        if (!RoleUtil.isAtLeast(eff, "KHADIM")) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");

        if ("KHADIM".equals(eff)) {
            List<String> my = servingBasesOf(me);
            if (my.stream().noneMatch(b -> b.equalsIgnoreCase(base))) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }

        if ("AMIN_OSRA".equals(eff)) {
            // only if scoped
            String scoped = me.roleForFamilyBase(base);
            if (scoped == null || !"AMIN_OSRA".equalsIgnoreCase(normRole(scoped))) {
                throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            }
        }
    }

    private void ensureCanPublish(User me, String familyBase) {
        String global = normRole(me.getRole());
        if ("AMIN_KHEDMA".equals(global) || "DEVELOPER".equals(global)) return;

        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        String scoped = me.roleForFamilyBase(base);
        if (scoped != null && "AMIN_OSRA".equalsIgnoreCase(normRole(scoped))) return;

        // fallback: if user is global AMIN_OSRA and base is his primary family
        String eff = effectiveRoleIn(me, base);
        if ("AMIN_OSRA".equals(eff) && FamilyUtil.mainFamily(me.getDeaconFamily()).equalsIgnoreCase(base)) return;

        throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
    }

    private SheetPayload parseOrEmpty(GradeSheet sheet) {
        if (sheet == null || sheet.getDataJson() == null || sheet.getDataJson().isBlank()) {
            return new SheetPayload(new ArrayList<>(), new LinkedHashMap<>());
        }
        try {
            return mapper.readValue(sheet.getDataJson(), new TypeReference<SheetPayload>() {});
        } catch (Exception e) {
            return new SheetPayload(new ArrayList<>(), new LinkedHashMap<>());
        }
    }

    private String newColId() {
        return "c_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    }

    private List<User> loadMakhdomMembers(String familyBase) {
        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null || base.isBlank()) return List.of();
        // return all MAKHDOM in base + A/B
        return userRepo.findByDeaconFamilyStartingWithAndRoleIn(base, List.of("MAKHDOM"));
    }

    // ----- Endpoints -----

    // View/edit sheet for a family (servants & above)
    @GetMapping("/sheet")
    public ResponseEntity<?> getSheet(@RequestParam String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        ensureCanViewSheet(me, base);

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        SheetPayload payload = parseOrEmpty(sheet);

        // ensure at least one column exists so UI can start
        List<Column> cols = payload.columns() == null ? new ArrayList<>() : new ArrayList<>(payload.columns());
        if (cols.isEmpty()) {
            cols.add(new Column(newColId(), "")); // empty title - editable
        }

        Map<String, Map<String, String>> rows = payload.rows() == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload.rows());

        List<User> members = loadMakhdomMembers(base);
        members.sort(Comparator.comparing(u -> String.valueOf(u.getFullName())));

        List<Map<String, Object>> memberViews = new ArrayList<>();
        for (User u : members) {
            String uid = String.valueOf(u.getId());
            Map<String, String> values = rows.getOrDefault(uid, new LinkedHashMap<>());
            // ensure all columns exist
            Map<String, String> normalized = new LinkedHashMap<>();
            for (Column c : cols) {
                normalized.put(c.id(), values.getOrDefault(c.id(), ""));
            }
            rows.put(uid, normalized);

            memberViews.add(new LinkedHashMap<>() {{
                put("id", u.getId());
                put("fullName", u.getFullName());
                put("values", normalized);
            }});
        }

        // persist normalization (keeps ids in sync)
        GradeSheet persisted = sheet;
        if (persisted == null) {
            persisted = GradeSheet.builder()
                    .familyBase(base)
                    .status("DRAFT")
                    .updatedAt(LocalDateTime.now())
                    .build();
        }
        try {
            persisted.setDataJson(mapper.writeValueAsString(new SheetPayload(cols, rows)));
        } catch (Exception ignored) {}
        persisted.setUpdatedAt(LocalDateTime.now());
        if (persisted.getStatus() == null) persisted.setStatus("DRAFT");
        gradeRepo.save(persisted);

        return ResponseEntity.ok(new SheetView(
                base,
                persisted.getStatus(),
                persisted.getUpdatedAt(),
                persisted.getPublishedAt(),
                cols,
                memberViews
        ));
    }

    // Save draft sheet (servants & above)
    @PutMapping("/sheet")
    public ResponseEntity<?> saveSheet(@RequestParam String family, @RequestBody SheetPayload body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        ensureCanEditSheet(me, base);

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        SheetPayload existing = parseOrEmpty(sheet);

        List<Column> cols = body != null && body.columns() != null ? new ArrayList<>(body.columns()) : new ArrayList<>();
        if (cols.isEmpty()) cols = existing.columns() == null ? new ArrayList<>() : new ArrayList<>(existing.columns());
        if (cols.isEmpty()) cols.add(new Column(newColId(), ""));

        // sanitize columns (unique ids, non-null)
        List<Column> sanitizedCols = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Column c : cols) {
            if (c == null) continue;
            String id = c.id() == null || c.id().isBlank() ? newColId() : c.id().trim();
            if (ids.contains(id)) continue;
            ids.add(id);
            String title = c.title() == null ? "" : c.title();
            sanitizedCols.add(new Column(id, title));
        }
        if (sanitizedCols.isEmpty()) sanitizedCols.add(new Column(newColId(), ""));

        // sanitize rows: only allow makhdom members in this base family
        List<User> members = loadMakhdomMembers(base);
        Set<String> allowedUserIds = new HashSet<>();
        for (User u : members) allowedUserIds.add(String.valueOf(u.getId()));

        Map<String, Map<String, String>> inRows = body != null && body.rows() != null ? body.rows() : new LinkedHashMap<>();
        Map<String, Map<String, String>> sanitizedRows = new LinkedHashMap<>();

        for (String uid : allowedUserIds) {
            Map<String, String> values = inRows.getOrDefault(uid, new LinkedHashMap<>());
            Map<String, String> normVals = new LinkedHashMap<>();
            for (Column c : sanitizedCols) {
                normVals.put(c.id(), values == null ? "" : String.valueOf(values.getOrDefault(c.id(), "")));
            }
            sanitizedRows.put(uid, normVals);
        }

        GradeSheet toSave = sheet;
        if (toSave == null) {
            toSave = GradeSheet.builder()
                    .familyBase(base)
                    .status("DRAFT")
                    .build();
        }
        try {
            toSave.setDataJson(mapper.writeValueAsString(new SheetPayload(sanitizedCols, sanitizedRows)));
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid sheet payload");
        }
        toSave.setUpdatedAt(LocalDateTime.now());
        if (toSave.getStatus() == null) toSave.setStatus("DRAFT");
        gradeRepo.save(toSave);

        return ResponseEntity.ok(Map.of("message", "saved", "familyBase", base, "status", toSave.getStatus(), "updatedAt", toSave.getUpdatedAt()));
    }

    // Publish sheet (Amin Osra scoped, Amin Khedma, Dev)
    @PostMapping("/sheet/publish")
    public ResponseEntity<?> publishSheet(@RequestParam String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        ensureCanPublish(me, base);

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        if (sheet == null) {
            // create empty and publish
            sheet = GradeSheet.builder()
                    .familyBase(base)
                    .status("PUBLISHED")
                    .updatedAt(LocalDateTime.now())
                    .publishedAt(LocalDateTime.now())
                    .publishedByUserId(me.getId())
                    .dataJson("{\"columns\":[],\"rows\":{}}")
                    .build();
        } else {
            sheet.setStatus("PUBLISHED");
            sheet.setPublishedAt(LocalDateTime.now());
            sheet.setPublishedByUserId(me.getId());
        }
        gradeRepo.save(sheet);

        return ResponseEntity.ok(Map.of("message", "published", "familyBase", base, "publishedAt", sheet.getPublishedAt()));
    }

    // Makhdom view (only own row) - must be published
    @GetMapping("/me")
    public ResponseEntity<?> myGrades(@RequestParam(required = false) String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family != null && !family.isBlank() ? family : me.getDeaconFamily());
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        if (sheet == null || !"PUBLISHED".equalsIgnoreCase(String.valueOf(sheet.getStatus()))) {
            // not published yet
            return ResponseEntity.ok(new MyGradesView(base, null, List.of(), new LinkedHashMap<>()));
        }

        SheetPayload payload = parseOrEmpty(sheet);
        List<Column> cols = payload.columns() == null ? List.of() : payload.columns();
        Map<String, Map<String, String>> rows = payload.rows() == null ? Map.of() : payload.rows();

        Map<String, String> values = rows.getOrDefault(String.valueOf(me.getId()), new LinkedHashMap<>());
        // ensure keys align
        Map<String, String> aligned = new LinkedHashMap<>();
        for (Column c : cols) {
            aligned.put(c.id(), values.getOrDefault(c.id(), ""));
        }

        return ResponseEntity.ok(new MyGradesView(base, sheet.getPublishedAt(), cols, aligned));
    }
}
