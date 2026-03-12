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

    public String baseFamily(User user) {
        if (user == null) return null;
        return baseNameForId(user.getDeaconFamilyId(), user.getDeaconFamily());
    }

    public List<String> servingBasesOf(User user) {
        if (user == null) return List.of();
        Set<String> out = new LinkedHashSet<>();
        addBase(out, user.getDeaconFamilyId(), user.getDeaconFamily());
        addBase(out, user.getDeaconFamily2Id(), user.getDeaconFamily2());
        addBase(out, user.getDeaconFamily3Id(), user.getDeaconFamily3());
        addBase(out, user.getDeaconFamily4Id(), user.getDeaconFamily4());

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

        if (matchesBase(user.getDeaconFamilyId(), user.getDeaconFamily(), base)) {
            String role = String.valueOf(user.getDeaconFamilyRole() == null ? user.getRole() : user.getDeaconFamilyRole()).trim();
            return normalizeRole(role);
        }
        if (matchesBase(user.getDeaconFamily2Id(), user.getDeaconFamily2(), base)) {
            return normalizeRole(user.getDeaconFamilyRole2());
        }
        if (matchesBase(user.getDeaconFamily3Id(), user.getDeaconFamily3(), base)) {
            return normalizeRole(user.getDeaconFamilyRole3());
        }
        if (matchesBase(user.getDeaconFamily4Id(), user.getDeaconFamily4(), base)) {
            return normalizeRole(user.getDeaconFamilyRole4());
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
        if (user == null) return null;
        return normalizeDisplayName(familyNameForId(user.getDeaconFamilyId(), user.getDeaconFamily()));
    }

    public String secondaryFamilyName(User user) {
        if (user == null) return null;
        return normalizeDisplayName(familyNameForId(user.getDeaconFamily2Id(), user.getDeaconFamily2()));
    }

    public String thirdFamilyName(User user) {
        if (user == null) return null;
        return normalizeDisplayName(familyNameForId(user.getDeaconFamily3Id(), user.getDeaconFamily3()));
    }

    public String fourthFamilyName(User user) {
        if (user == null) return null;
        return normalizeDisplayName(familyNameForId(user.getDeaconFamily4Id(), user.getDeaconFamily4()));
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
