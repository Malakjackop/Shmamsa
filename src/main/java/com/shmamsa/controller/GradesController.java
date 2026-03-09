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

    public record Column(String id, String title) {}
    public record SheetPayload(List<Column> columns, Map<String, Map<String, String>> rows) {}

    public record SheetView(
            String familyBase,
            String selectedTerm,
            String status,
            LocalDateTime updatedAt,
            LocalDateTime publishedAt,
            LocalDateTime firstPublishedAt,
            LocalDateTime secondPublishedAt,
            List<Column> columns,
            List<Map<String, Object>> members
    ) {}

    public record MyGradesView(
            String familyBase,
            LocalDateTime firstPublishedAt,
            LocalDateTime secondPublishedAt,
            List<Column> firstColumns,
            Map<String, String> firstValues,
            List<Column> secondColumns,
            Map<String, String> secondValues
    ) {}

    public record PublishSheetRequest(String resultTerm) {}
    public record ConfirmSchoolResultRequest(String result, String studyYear) {}

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

        String global = normRole(me.getRole());
        if ("AMIN_OSRA".equals(global)) {
            List<String> my = servingBasesOf(me);
            if (my.stream().anyMatch(b -> b.equalsIgnoreCase(base))) return "KHADIM";
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
            if (my.stream().noneMatch(b -> b.equalsIgnoreCase(base))) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
            return;
        }
        if ("AMIN_OSRA".equals(eff)) {
            String scoped = me.roleForFamilyBase(base);
            if (scoped == null || !"AMIN_OSRA".equalsIgnoreCase(normRole(scoped))) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
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
            if (my.stream().noneMatch(b -> b.equalsIgnoreCase(base))) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
        if ("AMIN_OSRA".equals(eff)) {
            String scoped = me.roleForFamilyBase(base);
            if (scoped == null || !"AMIN_OSRA".equalsIgnoreCase(normRole(scoped))) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }
    }

    private void ensureCanPublish(User me, String familyBase) {
        String global = normRole(me.getRole());
        if ("AMIN_KHEDMA".equals(global) || "DEVELOPER".equals(global)) return;

        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        String scoped = me.roleForFamilyBase(base);
        if (scoped != null && "AMIN_OSRA".equalsIgnoreCase(normRole(scoped))) return;

        String eff = effectiveRoleIn(me, base);
        String myBase = FamilyUtil.mainFamily(me.getDeaconFamily());
        if ("AMIN_OSRA".equals(eff) && myBase != null && myBase.equalsIgnoreCase(base)) return;

        throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
    }

    private String normalizeTerm(String raw) {
        String t = String.valueOf(raw == null ? "FIRST" : raw).trim().toUpperCase();
        return "SECOND".equals(t) ? "SECOND" : "FIRST";
    }

    private SheetPayload emptyPayload() {
        return new SheetPayload(new ArrayList<>(), new LinkedHashMap<>());
    }

    private SheetPayload parsePayloadJson(String json) {
        if (json == null || json.isBlank()) return emptyPayload();
        try {
            return mapper.readValue(json, new TypeReference<SheetPayload>() {});
        } catch (Exception e) {
            return emptyPayload();
        }
    }

    private SheetPayload parseTermPayload(GradeSheet sheet, String term) {
        if (sheet == null) return emptyPayload();
        String json = "SECOND".equals(normalizeTerm(term)) ? sheet.getSecondTermDataJson() : sheet.getFirstTermDataJson();
        if ((json == null || json.isBlank()) && "FIRST".equals(normalizeTerm(term))) json = sheet.getDataJson();
        return parsePayloadJson(json);
    }

    private void storeTermPayload(GradeSheet sheet, String term, SheetPayload payload) {
        try {
            String json = mapper.writeValueAsString(payload);
            if ("SECOND".equals(normalizeTerm(term))) {
                sheet.setSecondTermDataJson(json);
            } else {
                sheet.setFirstTermDataJson(json);
                sheet.setDataJson(json);
            }
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid sheet payload");
        }
    }

    private LocalDateTime publishedAtForTerm(GradeSheet sheet, String term) {
        if (sheet == null) return null;
        return "SECOND".equals(normalizeTerm(term)) ? sheet.getSecondPublishedAt() : sheet.getFirstPublishedAt();
    }

    private void refreshPublishMeta(GradeSheet sheet) {
        if (sheet == null) return;
        LocalDateTime first = sheet.getFirstPublishedAt();
        LocalDateTime second = sheet.getSecondPublishedAt();

        if (first == null && second == null) {
            sheet.setStatus("DRAFT");
            sheet.setPublishedAt(null);
            sheet.setResultTerm(null);
            sheet.setPublishedByUserId(null);
            return;
        }

        sheet.setStatus("PUBLISHED");
        if (second != null && (first == null || !second.isBefore(first))) {
            sheet.setPublishedAt(second);
            sheet.setResultTerm("SECOND");
            sheet.setPublishedByUserId(sheet.getSecondPublishedByUserId());
        } else {
            sheet.setPublishedAt(first);
            sheet.setResultTerm("FIRST");
            sheet.setPublishedByUserId(sheet.getFirstPublishedByUserId());
        }
    }

    private String newColId() {
        return "c_" + UUID.randomUUID().toString().replace("-", "").substring(0, 10);
    }

    private List<User> loadMakhdomMembers(String familyBase) {
        String base = FamilyUtil.mainFamily(familyBase);
        if (base == null || base.isBlank()) return List.of();
        return userRepo.findByDeaconFamilyStartingWithAndRoleIn(base, List.of("MAKHDOM"));
    }

    private List<Column> normalizedColumns(SheetPayload payload, boolean ensureOneColumn) {
        List<Column> cols = payload.columns() == null ? new ArrayList<>() : new ArrayList<>(payload.columns());
        if (ensureOneColumn && cols.isEmpty()) cols.add(new Column(newColId(), ""));
        return cols;
    }

    private Map<String, String> alignValues(List<Column> cols, Map<String, String> values) {
        Map<String, String> aligned = new LinkedHashMap<>();
        Map<String, String> safe = values == null ? Map.of() : values;
        for (Column c : cols) aligned.put(c.id(), safe.getOrDefault(c.id(), ""));
        return aligned;
    }

    private static String normAr(String s) {
        if (s == null) return "";
        return s.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .replace('أ', 'ا').replace('إ', 'ا').replace('آ', 'ا')
                .replaceAll("\\s+", " ").trim();
    }

    private static String advanceSchoolGradeString(String currentRaw) {
        String current = normAr(currentRaw);
        if (current.isBlank()) return null;
        record Step(String from, String to) {}
        List<Step> map = List.of(
                new Step("اولى ابتدائي", "تانيه ابتدائي"), new Step("اوله ابتدائي", "تانيه ابتدائي"),
                new Step("تانيه ابتدائي", "تالته ابتدائي"), new Step("ثانيه ابتدائي", "تالته ابتدائي"),
                new Step("تالته ابتدائي", "رابعه ابتدائي"), new Step("ثالثه ابتدائي", "رابعه ابتدائي"),
                new Step("رابعه ابتدائي", "خامسه ابتدائي"), new Step("خامسه ابتدائي", "سادسه ابتدائي"),
                new Step("سادسه ابتدائي", "اولى اعدادي"), new Step("اولى اعدادي", "تانيه اعدادي"),
                new Step("اوله اعدادي", "تانيه اعدادي"), new Step("تانيه اعدادي", "تالته اعدادي"),
                new Step("ثانيه اعدادي", "تالته اعدادي"), new Step("تالته اعدادي", "اولى ثانوي"),
                new Step("ثالثه اعدادي", "اولى ثانوي"), new Step("اولى ثانوي", "تانيه ثانوي"),
                new Step("اوله ثانوي", "تانيه ثانوي"), new Step("تانيه ثانوي", "تالته ثانوي"),
                new Step("ثانيه ثانوي", "تالته ثانوي")
        );
        for (Step s : map) if (current.equals(s.from)) return s.to;
        if (current.equals("تالته ثانوي") || current.equals("ثالثه ثانوي")) return "جامعة";
        return null;
    }

    private static String normalizeStoredStudyYear(String raw) {
        String value = normAr(raw);
        if (value.isBlank()) return null;
        return switch (value) {
            case "grade1_primary" -> "اولى ابتدائي";
            case "grade2_primary" -> "تانيه ابتدائي";
            case "grade3_primary" -> "تالته ابتدائي";
            case "grade4_primary" -> "رابعه ابتدائي";
            case "grade5_primary" -> "خامسه ابتدائي";
            case "grade6_primary" -> "سادسه ابتدائي";
            case "grade1_prep" -> "اولى اعدادي";
            case "grade2_prep" -> "تانيه اعدادي";
            case "grade3_prep" -> "تالته اعدادي";
            case "grade1_secondary" -> "اولى ثانوي";
            case "grade2_secondary" -> "تانيه ثانوي";
            case "grade3_secondary" -> "تالته ثانوي";
            default -> raw == null ? null : raw.trim();
        };
    }

    @GetMapping("/sheet")
    public ResponseEntity<?> getSheet(@RequestParam String family, @RequestParam(required = false) String term, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        String selectedTerm = normalizeTerm(term);
        ensureCanViewSheet(me, base);

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        SheetPayload payload = parseTermPayload(sheet, selectedTerm);
        List<Column> cols = normalizedColumns(payload, true);
        Map<String, Map<String, String>> rows = payload.rows() == null ? new LinkedHashMap<>() : new LinkedHashMap<>(payload.rows());

        List<User> members = loadMakhdomMembers(base);
        members.sort(Comparator.comparing(u -> String.valueOf(u.getFullName())));

        List<Map<String, Object>> memberViews = new ArrayList<>();
        for (User u : members) {
            String uid = String.valueOf(u.getId());
            Map<String, String> normalized = alignValues(cols, rows.getOrDefault(uid, new LinkedHashMap<>()));
            rows.put(uid, normalized);
            memberViews.add(new LinkedHashMap<>() {{
                put("id", u.getId());
                put("fullName", u.getFullName());
                put("values", normalized);
            }});
        }

        GradeSheet persisted = sheet;
        if (persisted == null) persisted = GradeSheet.builder().familyBase(base).status("DRAFT").updatedAt(LocalDateTime.now()).build();
        storeTermPayload(persisted, selectedTerm, new SheetPayload(cols, rows));
        persisted.setUpdatedAt(LocalDateTime.now());
        if (persisted.getStatus() == null) persisted.setStatus("DRAFT");
        gradeRepo.save(persisted);

        return ResponseEntity.ok(new SheetView(
                base,
                selectedTerm,
                persisted.getStatus(),
                persisted.getUpdatedAt(),
                publishedAtForTerm(persisted, selectedTerm),
                persisted.getFirstPublishedAt(),
                persisted.getSecondPublishedAt(),
                cols,
                memberViews
        ));
    }

    @PutMapping("/sheet")
    public ResponseEntity<?> saveSheet(@RequestParam String family, @RequestParam(required = false) String term, @RequestBody SheetPayload body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        String selectedTerm = normalizeTerm(term);
        ensureCanEditSheet(me, base);

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        SheetPayload existing = parseTermPayload(sheet, selectedTerm);

        List<Column> cols = body != null && body.columns() != null ? new ArrayList<>(body.columns()) : new ArrayList<>();
        if (cols.isEmpty()) cols = existing.columns() == null ? new ArrayList<>() : new ArrayList<>(existing.columns());
        if (cols.isEmpty()) cols.add(new Column(newColId(), ""));

        List<Column> sanitizedCols = new ArrayList<>();
        Set<String> ids = new HashSet<>();
        for (Column c : cols) {
            if (c == null) continue;
            String id = c.id() == null || c.id().isBlank() ? newColId() : c.id().trim();
            if (ids.contains(id)) continue;
            ids.add(id);
            sanitizedCols.add(new Column(id, c.title() == null ? "" : c.title()));
        }
        if (sanitizedCols.isEmpty()) sanitizedCols.add(new Column(newColId(), ""));

        List<User> members = loadMakhdomMembers(base);
        Set<String> allowedUserIds = new HashSet<>();
        for (User u : members) allowedUserIds.add(String.valueOf(u.getId()));

        Map<String, Map<String, String>> inRows = body != null && body.rows() != null ? body.rows() : new LinkedHashMap<>();
        Map<String, Map<String, String>> sanitizedRows = new LinkedHashMap<>();
        for (String uid : allowedUserIds) {
            Map<String, String> values = inRows.getOrDefault(uid, new LinkedHashMap<>());
            Map<String, String> normVals = new LinkedHashMap<>();
            for (Column c : sanitizedCols) normVals.put(c.id(), values == null ? "" : String.valueOf(values.getOrDefault(c.id(), "")));
            sanitizedRows.put(uid, normVals);
        }

        GradeSheet toSave = sheet;
        if (toSave == null) toSave = GradeSheet.builder().familyBase(base).status("DRAFT").build();
        storeTermPayload(toSave, selectedTerm, new SheetPayload(sanitizedCols, sanitizedRows));
        toSave.setUpdatedAt(LocalDateTime.now());
        if (toSave.getStatus() == null) toSave.setStatus("DRAFT");
        gradeRepo.save(toSave);

        return ResponseEntity.ok(Map.of("message", "saved", "familyBase", base, "selectedTerm", selectedTerm, "status", toSave.getStatus(), "updatedAt", toSave.getUpdatedAt()));
    }

    @PostMapping("/sheet/publish")
    public ResponseEntity<?> publishSheet(@RequestParam String family, @RequestBody(required = false) PublishSheetRequest body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        ensureCanPublish(me, base);

        String resultTerm = normalizeTerm(body == null ? null : body.resultTerm());
        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        if (sheet == null) sheet = GradeSheet.builder().familyBase(base).status("PUBLISHED").updatedAt(LocalDateTime.now()).build();

        if (sheet.getFirstTermDataJson() == null && sheet.getSecondTermDataJson() == null && sheet.getDataJson() != null) sheet.setFirstTermDataJson(sheet.getDataJson());
        if ("FIRST".equals(resultTerm) && (sheet.getFirstTermDataJson() == null || sheet.getFirstTermDataJson().isBlank())) storeTermPayload(sheet, "FIRST", emptyPayload());
        if ("SECOND".equals(resultTerm) && (sheet.getSecondTermDataJson() == null || sheet.getSecondTermDataJson().isBlank())) storeTermPayload(sheet, "SECOND", emptyPayload());

        LocalDateTime now = LocalDateTime.now();
        sheet.setStatus("PUBLISHED");
        sheet.setPublishedAt(now);
        sheet.setResultTerm(resultTerm);
        sheet.setPublishedByUserId(me.getId());
        if ("SECOND".equals(resultTerm)) {
            sheet.setSecondPublishedAt(now);
            sheet.setSecondPublishedByUserId(me.getId());
        } else {
            sheet.setFirstPublishedAt(now);
            sheet.setFirstPublishedByUserId(me.getId());
        }
        gradeRepo.save(sheet);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "published");
        out.put("familyBase", base);
        out.put("publishedAt", now);
        out.put("resultTerm", resultTerm);
        out.put("firstPublishedAt", sheet.getFirstPublishedAt());
        out.put("secondPublishedAt", sheet.getSecondPublishedAt());
        return ResponseEntity.ok(out);
    }

    @PostMapping("/sheet/unpublish")
    public ResponseEntity<?> unpublishSheet(@RequestParam String family, @RequestBody(required = false) PublishSheetRequest body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family);
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");
        ensureCanPublish(me, base);

        String resultTerm = normalizeTerm(body == null ? null : body.resultTerm());
        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        if (sheet == null) throw new ApiException(HttpStatus.BAD_REQUEST, "No sheet to unpublish");

        if ("SECOND".equals(resultTerm)) {
            sheet.setSecondPublishedAt(null);
            sheet.setSecondPublishedByUserId(null);
        } else {
            sheet.setFirstPublishedAt(null);
            sheet.setFirstPublishedByUserId(null);
        }

        refreshPublishMeta(sheet);
        sheet.setUpdatedAt(LocalDateTime.now());
        gradeRepo.save(sheet);

        Map<String, Object> out = new LinkedHashMap<>();
        out.put("message", "unpublished");
        out.put("familyBase", base);
        out.put("resultTerm", resultTerm);
        out.put("status", sheet.getStatus());
        out.put("publishedAt", publishedAtForTerm(sheet, resultTerm));
        out.put("firstPublishedAt", sheet.getFirstPublishedAt());
        out.put("secondPublishedAt", sheet.getSecondPublishedAt());
        return ResponseEntity.ok(out);
    }

    @GetMapping("/me")
    public ResponseEntity<?> myGrades(@RequestParam(required = false) String family, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family != null && !family.isBlank() ? family : me.getDeaconFamily());
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        if (sheet == null) {
            return ResponseEntity.ok(new MyGradesView(base, null, null, List.of(), new LinkedHashMap<>(), List.of(), new LinkedHashMap<>()));
        }

        SheetPayload firstPayload = parseTermPayload(sheet, "FIRST");
        SheetPayload secondPayload = parseTermPayload(sheet, "SECOND");
        List<Column> firstCols = normalizedColumns(firstPayload, false);
        List<Column> secondCols = normalizedColumns(secondPayload, false);
        Map<String, Map<String, String>> firstRows = firstPayload.rows() == null ? Map.of() : firstPayload.rows();
        Map<String, Map<String, String>> secondRows = secondPayload.rows() == null ? Map.of() : secondPayload.rows();
        Map<String, String> firstValues = alignValues(firstCols, firstRows.get(String.valueOf(me.getId())));
        Map<String, String> secondValues = alignValues(secondCols, secondRows.get(String.valueOf(me.getId())));

        if (sheet.getFirstPublishedAt() == null) {
            firstCols = List.of();
            firstValues = new LinkedHashMap<>();
        }
        if (sheet.getSecondPublishedAt() == null) {
            secondCols = List.of();
            secondValues = new LinkedHashMap<>();
        }

        return ResponseEntity.ok(new MyGradesView(base, sheet.getFirstPublishedAt(), sheet.getSecondPublishedAt(), firstCols, firstValues, secondCols, secondValues));
    }

    @PostMapping("/confirm-school-result")
    public ResponseEntity<?> confirmSchoolResult(@RequestParam(required = false) String family, @RequestBody(required = false) ConfirmSchoolResultRequest body, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));
        User me = userRepo.findByUsername(auth.getName()).orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        String base = FamilyUtil.mainFamily(family != null && !family.isBlank() ? family : me.getDeaconFamily());
        if (base == null || base.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "family is required");

        GradeSheet sheet = gradeRepo.findByFamilyBaseIgnoreCase(base).orElse(null);
        if (sheet == null || sheet.getSecondPublishedAt() == null) throw new ApiException(HttpStatus.BAD_REQUEST, "Second term grades are not published");

        String status = normAr(me.getStatus());
        String studyType = normAr(me.getStudyType());
        String studyYear = body == null || body.studyYear() == null ? "" : body.studyYear().trim();
        String result = body == null || body.result() == null ? "" : body.result().trim().toUpperCase();

        if ("graduate".equalsIgnoreCase(status) || "خريج".equals(status)) {
            result = "GRADUATE";
        } else if ("university".equalsIgnoreCase(studyType) || "جامعه".equals(studyType) || "جامعة".equals(studyType)) {
            if (studyYear.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "studyYear is required");
            me.setUniversityGrade(studyYear);
            result = "UNIVERSITY";
        } else {
            if (!studyYear.isBlank()) {
                me.setSchoolGrade(studyYear);
                result = "PASS";
            } else {
                if (!("PASS".equals(result) || "FAIL".equals(result))) throw new ApiException(HttpStatus.BAD_REQUEST, "result must be PASS or FAIL");
                if ("PASS".equals(result)) {
                    String normalizedCurrent = normalizeStoredStudyYear(me.getSchoolGrade());
                    String next = advanceSchoolGradeString(normalizedCurrent);
                    if (next != null) {
                        if ("جامعة".equals(next)) {
                            me.setStudyType("جامعة");
                            me.setUniversityGrade(me.getUniversityGrade() == null || me.getUniversityGrade().isBlank() ? "أولى جامعة" : me.getUniversityGrade());
                            me.setSchoolGrade(null);
                        } else {
                            me.setSchoolGrade(next);
                        }
                    }
                }
            }
        }

        me.setLastSchoolResultFamilyBase(base);
        me.setLastSchoolResultPublishedAt(sheet.getSecondPublishedAt());
        me.setLastSchoolResultStatus(result);

        userRepo.save(me);
        me.setPassword(null);
        return ResponseEntity.ok(me);
    }
}
