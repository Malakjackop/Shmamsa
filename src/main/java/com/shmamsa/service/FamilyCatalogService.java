package com.shmamsa.service;

import com.shmamsa.dto.FamilyOptionDto;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.repository.FamilyCatalogRepository;
import jakarta.annotation.PostConstruct;
import jakarta.transaction.Transactional;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class FamilyCatalogService {

    private final FamilyCatalogRepository familyCatalogRepository;

    @PostConstruct
    @Transactional
    public void seedDefaults() {
        for (FamilyCatalog def : defaultFamilies()) {
            FamilyCatalog item = familyCatalogRepository.findByCode(def.getCode()).orElseGet(FamilyCatalog::new);
            item.setCode(def.getCode());
            item.setNameAr(def.getNameAr());
            item.setBaseName(def.getBaseName());
            item.setBranch(def.getBranch());
            item.setCategory(def.getCategory());
            item.setActive(def.getActive());
            item.setSortOrder(def.getSortOrder());
            item.setServantSelectable(def.getServantSelectable());
            item.setMemberSelectable(def.getMemberSelectable());
            familyCatalogRepository.save(item);
        }
    }

    public List<FamilyOptionDto> listForAudience(String audience) {
        String normalized = String.valueOf(audience == null ? "" : audience).trim().toUpperCase(Locale.ROOT);
        List<FamilyCatalog> items = "SERVANT".equals(normalized)
                ? familyCatalogRepository.findByActiveTrueAndServantSelectableTrueOrderBySortOrderAscNameArAsc()
                : familyCatalogRepository.findByActiveTrueAndMemberSelectableTrueOrderBySortOrderAscNameArAsc();
        return items.stream().map(this::toDto).toList();
    }

    public List<String> listSelectableBaseNames() {
        Set<String> out = new LinkedHashSet<>();
        for (FamilyCatalog item : familyCatalogRepository.findByActiveTrueAndServantSelectableTrueOrderBySortOrderAscNameArAsc()) {
            out.add(String.valueOf(item.getNameAr()).trim());
        }
        return out.stream().filter(x -> !x.isBlank()).toList();
    }

    public List<Long> relatedIdsForSelection(String familyName) {
        String x = String.valueOf(familyName == null ? "" : familyName).trim();
        if (x.isBlank()) return List.of();
        FamilyCatalog selected = findByName(x);
        if (selected == null || !Boolean.TRUE.equals(selected.getActive())) return List.of();

        String baseName = String.valueOf(selected.getBaseName() == null ? selected.getNameAr() : selected.getBaseName()).trim();
        if (baseName.isBlank()) return selected.getId() == null ? List.of() : List.of(selected.getId());

        return familyCatalogRepository.findByActiveTrueAndBaseName(baseName).stream()
                .filter(item -> item.getId() != null)
                .map(FamilyCatalog::getId)
                .distinct()
                .toList();
    }

    public List<String> relatedNamesPlusAll(String familyName) {
        String x = String.valueOf(familyName == null ? "" : familyName).trim();
        if (x.isBlank()) return List.of("ALL");
        FamilyCatalog selected = findByName(x);
        if (selected == null || !Boolean.TRUE.equals(selected.getActive())) return List.of("ALL", x);

        String baseName = String.valueOf(selected.getBaseName() == null ? selected.getNameAr() : selected.getBaseName()).trim();
        List<String> names = familyCatalogRepository.findByActiveTrueAndBaseName(baseName).stream()
                .map(FamilyCatalog::getNameAr)
                .filter(name -> name != null && !name.isBlank())
                .distinct()
                .toList();

        List<String> out = new ArrayList<>();
        out.add("ALL");
        out.addAll(names);
        return out;
    }

    public boolean isValidServantFamily(String name) {
        String x = String.valueOf(name == null ? "" : name).trim();
        FamilyCatalog item = findByName(x);
        return item != null && Boolean.TRUE.equals(item.getActive()) && Boolean.TRUE.equals(item.getServantSelectable());
    }

    public boolean isValidMemberFamily(String name) {
        String x = String.valueOf(name == null ? "" : name).trim();
        FamilyCatalog item = findByName(x);
        return item != null && Boolean.TRUE.equals(item.getActive()) && Boolean.TRUE.equals(item.getMemberSelectable());
    }

    public FamilyCatalog findById(Long id) {
        if (id == null) return null;
        return familyCatalogRepository.findById(id).orElse(null);
    }

    public FamilyCatalog findByName(String name) {
        String x = String.valueOf(name == null ? "" : name).trim();
        if (x.isBlank()) return null;
        FamilyCatalog exact = familyCatalogRepository.findByNameAr(x).orElse(null);
        if (exact != null) return exact;

        String target = normalizedArabicKey(x);
        for (FamilyCatalog item : familyCatalogRepository.findAll()) {
            if (target.equals(normalizedArabicKey(item.getNameAr()))
                    || target.equals(normalizedArabicKey(item.getBaseName()))) {
                return item;
            }
        }
        return null;
    }

    public String baseNameForName(String familyName) {
        FamilyCatalog item = findByName(familyName);
        if (item == null) return String.valueOf(familyName == null ? "" : familyName).trim();
        return String.valueOf(item.getBaseName() == null ? item.getNameAr() : item.getBaseName()).trim();
    }

    public Long idForName(String familyName) {
        FamilyCatalog item = findByName(familyName);
        return item == null ? null : item.getId();
    }

    public FamilyCatalog resolveMemberFamily(Long id, String name) {
        return resolveFamily(id, name, false);
    }

    public FamilyCatalog resolveServantFamily(Long id, String name) {
        return resolveFamily(id, name, true);
    }

    private FamilyCatalog resolveFamily(Long id, String name, boolean servantAudience) {
        if (id != null) {
            FamilyCatalog item = familyCatalogRepository.findById(id)
                    .orElseThrow(() -> new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DEACON_FAMILY", "Invalid deacon family"));
            validateAudience(item, servantAudience);
            return item;
        }

        String x = String.valueOf(name == null ? "" : name).trim();
        if (x.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "DEACON_FAMILY_REQUIRED", "Deacon family is required");
        }
        FamilyCatalog item = findByName(x);
        if (item == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DEACON_FAMILY", "Invalid deacon family");
        }
        validateAudience(item, servantAudience);
        return item;
    }

    private String normalizedArabicKey(String value) {
        String normalized = String.valueOf(value == null ? "" : value)
                .trim()
                .replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .replace('أ', 'ا')
                .replace('إ', 'ا')
                .replace('آ', 'ا')
                .replace('ؤ', 'و')
                .replace('ئ', 'ي')
                .replace('ة', 'ه')
                .replace('ى', 'ي')
                .replaceAll("ي+", "ي")
                .replaceAll("\\s+", " ");
        return normalized.toLowerCase(Locale.ROOT);
    }

    private void validateAudience(FamilyCatalog item, boolean servantAudience) {
        boolean allowed = servantAudience
                ? Boolean.TRUE.equals(item.getServantSelectable())
                : Boolean.TRUE.equals(item.getMemberSelectable());
        if (!Boolean.TRUE.equals(item.getActive()) || !allowed) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_DEACON_FAMILY", "Invalid deacon family");
        }
    }

    private FamilyOptionDto toDto(FamilyCatalog item) {
        return FamilyOptionDto.builder()
                .id(item.getId())
                .code(item.getCode())
                .nameAr(item.getNameAr())
                .baseName(item.getBaseName())
                .branch(item.getBranch())
                .category(item.getCategory())
                .build();
    }

    private List<FamilyCatalog> defaultFamilies() {
        return List.of(
                family("SAMAEYIN", "اسرة السمائين", "اسرة السمائين", null, "FAMILY", 10, true, true),
                family("ABANOUB", "اسرة القديس ابانوب", "اسرة القديس ابانوب", null, "FAMILY", 20, true, true),
                family("DIOSCORUS", "اسرة القديس ديسقورس", "اسرة القديس ديسقورس", null, "FAMILY", 30, true, true),
                family("SIDHOM_BISHAY", "اسرة القديس سيدهم بشاي", "اسرة القديس سيدهم بشاي", null, "FAMILY", 40, true, true),
                family("ASKLABIUS", "اسرة القديس اسكلابيوس", "اسرة القديس اسكلابيوس", null, "FAMILY", 50, true, true),
                family("KYRILLOS", "اسرة القديس البابا كيرلس", "اسرة القديس البابا كيرلس", null, "FAMILY", 60, true, false),
                family("KYRILLOS_A", "اسرة القديس البابا كيرلس أ", "اسرة القديس البابا كيرلس", "A", "FAMILY", 61, false, true),
                family("KYRILLOS_B", "اسرة القديس البابا كيرلس ب", "اسرة القديس البابا كيرلس", "B", "FAMILY", 62, false, true),
                family("ABRAM", "اسرة القديس الانبا ابرام", "اسرة القديس الانبا ابرام", null, "FAMILY", 70, true, false),
                family("ABRAM_A", "اسرة القديس الانبا ابرام أ", "اسرة القديس الانبا ابرام", "A", "FAMILY", 71, false, true),
                family("ABRAM_B", "اسرة القديس الانبا ابرام ب", "اسرة القديس الانبا ابرام", "B", "FAMILY", 72, false, true),
                family("STEPHANOS", "اسرة القديس اسطفانوس", "اسرة القديس اسطفانوس", null, "FAMILY", 80, true, false),
                family("STEPHANOS_A", "اسرة القديس اسطفانوس أ", "اسرة القديس اسطفانوس", "A", "FAMILY", 81, false, true),
                family("STEPHANOS_B", "اسرة القديس اسطفانوس ب", "اسرة القديس اسطفانوس", "B", "FAMILY", 82, false, true),
                family("MARMARKOS_KHORS", "خورس مارمرقس", "خورس مارمرقس", null, "KHORS", 90, true, false),
                family("ATHANASIUS_KHORS", "خورس البابا اثناسيوس", "خورس البابا اثناسيوس", null, "KHORS", 100, true, false)
        );
    }

    private FamilyCatalog family(String code, String nameAr, String baseName, String branch, String category,
                                 int sortOrder, boolean servantSelectable, boolean memberSelectable) {
        return FamilyCatalog.builder()
                .code(code)
                .nameAr(nameAr)
                .baseName(baseName)
                .branch(branch)
                .category(category)
                .active(true)
                .sortOrder(sortOrder)
                .servantSelectable(servantSelectable)
                .memberSelectable(memberSelectable)
                .build();
    }
}
