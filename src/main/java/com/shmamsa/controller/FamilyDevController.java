package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.repository.FamilyCatalogRepository;
import com.shmamsa.repository.UserFamilyRoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/dev/families")
@RequiredArgsConstructor
public class FamilyDevController {

    private static final List<String> ARABIC_BRANCH_LETTERS = List.of(
            "أ", "ب", "ج", "د", "ه", "و", "ز", "ح", "ط", "ي",
            "ك", "ل", "م", "ن", "س", "ع", "ف", "ص", "ق", "ر",
            "ش", "ت", "ث", "خ", "ذ", "ض", "ظ"
    );

    private static final List<String> ENGLISH_BRANCH_LETTERS = List.of(
            "A", "B", "C", "D", "E", "F", "G", "H", "I", "J",
            "K", "L", "M", "N", "O", "P", "Q", "R", "S", "T",
            "U", "V", "W", "X", "Y", "Z"
    );

    private final FamilyCatalogRepository familyRepo;
    private final UserFamilyRoleRepository userFamilyRoleRepo;

    private void ensureDeveloper(Authentication auth) {
        if (auth == null || auth.getAuthorities() == null) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Developer access only");
        }
        boolean isDev = auth.getAuthorities().stream()
                .anyMatch(a -> {
                    String role = a.getAuthority().replace("ROLE_", "");
                    return "DEVELOPER".equalsIgnoreCase(role);
                });
        if (!isDev) {
            throw new ApiException(HttpStatus.FORBIDDEN, "FORBIDDEN", "Developer access only");
        }
    }

    public record CreateFamilyRequest(
            String nameAr,
            String baseName,
            Integer branchCount,
            String category,
            Boolean servantSelectable,
            Boolean memberSelectable,
            Boolean khorsSelectable,
            Boolean attendKhorsSelectable,
            String directJoinGrades,
            String directJoinFrom,
            String directJoinUntil
    ) {}

    public record UpdateFamilyRequest(
            String nameAr,
            String baseName,
            String branch,
            String category,
            Boolean servantSelectable,
            Boolean memberSelectable,
            Boolean khorsSelectable,
            Boolean attendKhorsSelectable,
            Integer branchCount,
            String directJoinGrades,
            String directJoinFrom,
            String directJoinUntil
    ) {}

    public record ReorderItem(Long id, Integer sortOrder) {}

    private String nextFamilyCode() {
        int maxNum = 0;
        for (FamilyCatalog f : familyRepo.findAll()) {
            String c = f.getCode();
            if (c != null && c.matches("F\\d+")) {
                int num = Integer.parseInt(c.substring(1));
                if (num > maxNum) maxNum = num;
            }
        }
        return "F" + (maxNum + 1);
    }

    private List<FamilyCatalog> createBranches(String code, String nameAr, String baseName, String category,
                                                int branchCount, int baseSortOrder, boolean memberSelectable) {
        List<FamilyCatalog> branches = new ArrayList<>();
        for (int i = 0; i < branchCount && i < ENGLISH_BRANCH_LETTERS.size(); i++) {
            String enLetter = ENGLISH_BRANCH_LETTERS.get(i);
            String arLetter = ARABIC_BRANCH_LETTERS.get(i);
            String branchCode = code + "." + (i + 1);
            String branchName = nameAr + " " + arLetter;

            if (familyRepo.findByCode(branchCode).isPresent()) {
                throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_CODE",
                        "Branch code " + branchCode + " already exists");
            }

            FamilyCatalog branch = buildFamily(branchCode, branchName, baseName, enLetter, category,
                    baseSortOrder + (i + 1), false, false, memberSelectable);
            branches.add(familyRepo.save(branch));
        }
        return branches;
    }

    @GetMapping
    public ResponseEntity<List<FamilyCatalog>> getAll(Authentication auth) {
        ensureDeveloper(auth);
        return ResponseEntity.ok(familyRepo.findAllByOrderBySortOrderAsc());
    }

    @Transactional
    @PostMapping
    public ResponseEntity<?> create(@RequestBody CreateFamilyRequest req, Authentication auth) {
        ensureDeveloper(auth);

        if (req.nameAr() == null || req.nameAr().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NAME_REQUIRED", "Arabic name is required");
        }

        if (familyRepo.findByNameAr(req.nameAr().trim()).isPresent()) {
            throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_NAME", "Family name already exists");
        }

        String code = nextFamilyCode();
        String category = req.category() != null ? req.category().trim().toUpperCase() : "FAMILY";
        String baseName = req.baseName() != null ? req.baseName().trim() : req.nameAr().trim();
        int branchCount = req.branchCount() != null ? req.branchCount() : 0;

        if (branchCount < 0 || branchCount > 26) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BRANCH_COUNT", "Branch count must be between 0 and 26");
        }

        Integer maxOrder = familyRepo.findAllByOrderBySortOrderAsc().stream()
                .mapToInt(f -> f.getSortOrder() != null ? f.getSortOrder() : 0)
                .max()
                .orElse(0);

        List<FamilyCatalog> created = new ArrayList<>();

        if (branchCount == 0) {
            FamilyCatalog family = buildFamily(code, req.nameAr().trim(), baseName, null, category,
                    maxOrder + 10, true, req);
            created.add(familyRepo.save(family));
        } else {
            FamilyCatalog parent = buildFamily(code, baseName, baseName, null, category,
                    maxOrder + 10, true,
                    req.servantSelectable() != null && req.servantSelectable(),
                    false);
            created.add(familyRepo.save(parent));

            created.addAll(createBranches(code, req.nameAr().trim(), baseName, category, branchCount,
                    maxOrder + 10, req.memberSelectable() != null && req.memberSelectable()));
        }

        return ResponseEntity.ok(created);
    }

    private FamilyCatalog buildFamily(String code, String nameAr, String baseName, String branch,
                                      String category, int sortOrder, boolean active,
                                      CreateFamilyRequest req) {
        return FamilyCatalog.builder()
                .code(code)
                .nameAr(nameAr)
                .baseName(baseName)
                .branch(branch)
                .category(category)
                .active(active)
                .sortOrder(sortOrder)
                .servantSelectable(req.servantSelectable() != null && req.servantSelectable())
                .memberSelectable(req.memberSelectable() != null && req.memberSelectable())
                .khorsSelectable(req.khorsSelectable() != null && req.khorsSelectable())
                .attendKhorsSelectable(req.attendKhorsSelectable() != null && req.attendKhorsSelectable())
                .directJoinGrades(req.directJoinGrades())
                .directJoinFrom(req.directJoinFrom() != null ? java.time.LocalDate.parse(req.directJoinFrom()) : null)
                .directJoinUntil(req.directJoinUntil() != null ? java.time.LocalDate.parse(req.directJoinUntil()) : null)
                .build();
    }

    private FamilyCatalog buildFamily(String code, String nameAr, String baseName, String branch,
                                      String category, int sortOrder, boolean active,
                                      boolean servantSelectable, boolean memberSelectable) {
        return FamilyCatalog.builder()
                .code(code)
                .nameAr(nameAr)
                .baseName(baseName)
                .branch(branch)
                .category(category)
                .active(active)
                .sortOrder(sortOrder)
                .servantSelectable(servantSelectable)
                .memberSelectable(memberSelectable)
                .khorsSelectable(false)
                .attendKhorsSelectable(false)
                .build();
    }

    @Transactional
    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody UpdateFamilyRequest req, Authentication auth) {
        ensureDeveloper(auth);

        FamilyCatalog family = familyRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Family not found"));

        if (req.nameAr() != null && !req.nameAr().isBlank()) {
            String trimmed = req.nameAr().trim();
            familyRepo.findByNameAr(trimmed).ifPresent(existing -> {
                if (!existing.getId().equals(id)) {
                    throw new ApiException(HttpStatus.CONFLICT, "DUPLICATE_NAME", "Family name already exists");
                }
            });
            family.setNameAr(trimmed);
        }

        if (req.baseName() != null) {
            family.setBaseName(req.baseName().trim());
        }
        if (req.category() != null) {
            family.setCategory(req.category().trim().toUpperCase());
        }
        if (req.servantSelectable() != null) {
            family.setServantSelectable(req.servantSelectable());
        }
        if (req.memberSelectable() != null) {
            family.setMemberSelectable(req.memberSelectable());
        }
        if (req.khorsSelectable() != null) {
            family.setKhorsSelectable(req.khorsSelectable());
        }
        if (req.attendKhorsSelectable() != null) {
            family.setAttendKhorsSelectable(req.attendKhorsSelectable());
        }
        family.setDirectJoinGrades(req.directJoinGrades() != null ? req.directJoinGrades().trim() : null);
        family.setDirectJoinFrom(req.directJoinFrom() != null
                ? (req.directJoinFrom().isBlank() ? null : LocalDate.parse(req.directJoinFrom()))
                : null);
        family.setDirectJoinUntil(req.directJoinUntil() != null
                ? (req.directJoinUntil().isBlank() ? null : LocalDate.parse(req.directJoinUntil()))
                : null);

        int branchCount = req.branchCount() != null ? req.branchCount() : 0;
        if (branchCount < 0 || branchCount > 26) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_BRANCH_COUNT", "Branch count must be between 0 and 26");
        }

        familyRepo.save(family);

        List<FamilyCatalog> result = new ArrayList<>();
        result.add(family);

        if (branchCount > 0) {
            Integer maxOrder = familyRepo.findAllByOrderBySortOrderAsc().stream()
                    .mapToInt(f -> f.getSortOrder() != null ? f.getSortOrder() : 0)
                    .max()
                    .orElse(0);

            String nameAr = family.getNameAr();
            String baseName = family.getBaseName() != null ? family.getBaseName() : nameAr;
            String category = family.getCategory();
            String code = family.getCode();

            result.addAll(createBranches(code, nameAr, baseName, category, branchCount,
                    maxOrder + 10,
                    family.getMemberSelectable() != null && family.getMemberSelectable()));
        }

        return ResponseEntity.ok(result);
    }

    @PutMapping("/{id}/toggle-active")
    public ResponseEntity<?> toggleActive(@PathVariable Long id, Authentication auth) {
        ensureDeveloper(auth);

        FamilyCatalog family = familyRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Family not found"));

        if (family.getActive()) {
            boolean hasUsers = userFamilyRoleRepo.existsByFamilyId(id);
            if (hasUsers) {
                throw new ApiException(HttpStatus.CONFLICT, "FAMILY_HAS_USERS",
                        "Cannot deactivate family that has associated accounts. Remove all user assignments first.");
            }
        }

        family.setActive(!family.getActive());
        familyRepo.save(family);
        return ResponseEntity.ok(Map.of("id", family.getId(), "active", family.getActive()));
    }

    @Transactional
    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        ensureDeveloper(auth);

        FamilyCatalog family = familyRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Family not found"));

        boolean hasUsers = userFamilyRoleRepo.existsByFamilyId(id);
        if (hasUsers) {
            throw new ApiException(HttpStatus.CONFLICT, "FAMILY_HAS_USERS",
                    "Cannot delete family that has associated accounts. Remove all user assignments first.");
        }

        familyRepo.delete(family);
        return ResponseEntity.ok(Map.of("message", "Family deleted", "id", id));
    }

    @PutMapping("/reorder")
    public ResponseEntity<?> reorder(@RequestBody List<ReorderItem> items, Authentication auth) {
        ensureDeveloper(auth);

        for (ReorderItem item : items) {
            if (item.id() == null) continue;
            familyRepo.findById(item.id()).ifPresent(f -> {
                f.setSortOrder(item.sortOrder() != null ? item.sortOrder() : 0);
                familyRepo.save(f);
            });
        }

        return ResponseEntity.ok(Map.of("message", "Order updated"));
    }
}
