package com.shmamsa.service;

import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.model.User;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class FamilyAccessService {

    private final FamilyCatalogService familyCatalogService;
    private final UserFamilyRoleService userFamilyRoleService;

    public String baseFamily(User user) {
        List<com.shmamsa.model.UserFamilyAssignmentView> assignments = userFamilyRoleService.getAssignments(user);
        if (assignments.isEmpty()) return null;
        com.shmamsa.model.UserFamilyAssignmentView first = assignments.get(0);
        return baseNameForId(first.getFamilyId(), first.getFamilyName());
    }

    public List<String> servingBasesOf(User user) {
        if (user == null) return List.of();
        Set<String> out = new LinkedHashSet<>();
        for (com.shmamsa.model.UserFamilyAssignmentView assignment : userFamilyRoleService.getAssignments(user)) {
            addBase(out, assignment.getFamilyId(), assignment.getFamilyName());
        }

        String role = normRole(user.getRole());
        if ("KHADIM".equals(role)) {
            String scope = String.valueOf(user.getServingScope() == null ? "" : user.getServingScope()).trim().toUpperCase(Locale.ROOT);
            if ("KHORS_ONLY".equals(scope) || "BOTH".equals(scope)) {
                String k = String.valueOf(user.getKhors() == null ? "" : user.getKhors()).trim().toUpperCase(Locale.ROOT);
                if ("MARMARKOS".equals(k) || "BOTH".equals(k)) out.add("خورس مارمرقس");
                if ("ATHANASIUS".equals(k) || "BOTH".equals(k)) out.add("خورس البابا اثناسيوس");
            }
        }
        return new ArrayList<>(out);
    }

    public boolean belongsToBase(User user, String familyBase) {
        String base = String.valueOf(familyBase == null ? "" : familyBase).trim();
        if (base.isBlank() || "ALL".equalsIgnoreCase(base)) return true;
        return servingBasesOf(user).stream().anyMatch(x -> x.equalsIgnoreCase(base));
    }

    public String scopedRole(User user, String familyBase) {
        if (user == null) return null;
        String base = String.valueOf(familyBase == null ? "" : familyBase).trim();
        if (base.isBlank()) return normalizeRole(user.getRole());

        List<com.shmamsa.model.UserFamilyAssignmentView> assignments = userFamilyRoleService.getAssignments(user);
        for (int i = 0; i < assignments.size(); i++) {
            com.shmamsa.model.UserFamilyAssignmentView assignment = assignments.get(i);
            if (matchesBase(assignment.getFamilyId(), assignment.getFamilyName(), base)) {
                String role = assignment.getRole();
                if ((role == null || role.isBlank()) && i == 0) role = user.getRole();
                return normalizeRole(role);
            }
        }
        return null;
    }

    public List<Long> relatedIdsForSelection(String familyName) {
        return familyCatalogService.relatedIdsForSelection(familyName);
    }

    public String baseNameForId(Long familyId, String fallbackName) {
        if (familyId != null) {
            FamilyCatalog item = familyCatalogService.findById(familyId);
            if (item != null) {
                String base = String.valueOf(item.getBaseName() == null ? item.getNameAr() : item.getBaseName()).trim();
                if (!base.isBlank()) return base;
            }
        }
        return familyCatalogService.baseNameForName(fallbackName);
    }

    public String baseNameForName(String familyName) {
        return familyCatalogService.baseNameForName(familyName);
    }

    public String familyNameForId(Long familyId, String fallbackName) {
        if (familyId != null) {
            FamilyCatalog item = familyCatalogService.findById(familyId);
            if (item != null && item.getNameAr() != null && !item.getNameAr().isBlank()) {
                return item.getNameAr().trim();
            }
        }
        return String.valueOf(fallbackName == null ? "" : fallbackName).trim();
    }

    public Long familyIdForName(String familyName) {
        return familyCatalogService.idForName(familyName);
    }

    public String primaryFamilyName(User user) {
        return familyNameAt(user, 0);
    }

    public String secondaryFamilyName(User user) {
        return familyNameAt(user, 1);
    }

    public String thirdFamilyName(User user) {
        return familyNameAt(user, 2);
    }

    public String fourthFamilyName(User user) {
        return familyNameAt(user, 3);
    }

    public String primaryFamilyRole(User user) {
        return familyRoleAt(user, 0);
    }

    public String secondaryFamilyRole(User user) {
        return familyRoleAt(user, 1);
    }

    public String thirdFamilyRole(User user) {
        return familyRoleAt(user, 2);
    }

    public String fourthFamilyRole(User user) {
        return familyRoleAt(user, 3);
    }

    private void addBase(Set<String> set, Long familyId, String fallbackName) {
        String base = baseNameForId(familyId, fallbackName);
        if (base == null || base.isBlank() || "SYSTEM".equalsIgnoreCase(base)) return;
        set.add(base);
    }

    private boolean matchesBase(Long familyId, String fallbackName, String familyBase) {
        String base = baseNameForId(familyId, fallbackName);
        return base != null && base.equalsIgnoreCase(String.valueOf(familyBase == null ? "" : familyBase).trim());
    }

    private String normalizeDisplayName(String value) {
        String normalized = String.valueOf(value == null ? "" : value).trim();
        if (normalized.isBlank() || "SYSTEM".equalsIgnoreCase(normalized)) return null;
        return normalized;
    }

    public String normalizeRole(String raw) {
        return normRole(raw);
    }

    private String familyNameAt(User user, int index) {
        if (user == null) return null;
        List<com.shmamsa.model.UserFamilyAssignmentView> assignments = userFamilyRoleService.getAssignments(user);
        if (index < 0 || index >= assignments.size()) return null;
        com.shmamsa.model.UserFamilyAssignmentView assignment = assignments.get(index);
        return normalizeDisplayName(familyNameForId(assignment.getFamilyId(), assignment.getFamilyName()));
    }

    private String familyRoleAt(User user, int index) {
        if (user == null) return null;
        List<com.shmamsa.model.UserFamilyAssignmentView> assignments = userFamilyRoleService.getAssignments(user);
        if (index < 0 || index >= assignments.size()) return null;
        return normalizeDisplayName(assignments.get(index).getRole());
    }

    private String normRole(String raw) {
        if (raw == null) return "";
        String r = raw.trim().replace("ROLE_", "");
        String upper = r.toUpperCase(Locale.ROOT).replaceAll("[-\\s]+", "_");
        String ar = r.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .trim()
                .replaceAll("\\s+", " ");
        if (ar.equals("خادم")) return "KHADIM";
        if (ar.equals("امين اسرة") || ar.equals("أمين أسرة") || ar.equals("امين الاسرة") || ar.equals("أمين الاسره") || ar.equals("امين الأسرة")) return "AMIN_OSRA";
        if (ar.equals("امين خدمة") || ar.equals("أمين خدمة") || ar.equals("امين الخدمه") || ar.equals("أمين الخدمه")) return "AMIN_KHEDMA";
        return upper;
    }
}
