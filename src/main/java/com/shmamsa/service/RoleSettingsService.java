package com.shmamsa.service;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.RoleSettings;
import com.shmamsa.repository.RoleSettingsRepository;
import org.springframework.http.HttpStatus;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class RoleSettingsService {

    private final RoleSettingsRepository repo;

    public static final List<String> ALL_PERMISSIONS = List.of(
            "VIEW_ATTENDANCE",
            "TAKE_ATTENDANCE",
            "VIEW_FAMILY_INFO",
            "MANAGE_FAMILY_INFO",
            "MANAGE_EVENTS",
            "MANAGE_ANNOUNCEMENTS",
            "MANAGE_IFTEKAD",
            "TRANSFER_MEMBERS",
            "MANAGE_ROLES",
            "START_NEW_YEAR",
            "MANAGE_KHORS",
            "VIEW_GRADES",
            "MANAGE_REGISTRATION_FIELDS",
            "MANAGE_FAMILIES",
            "MANAGE_SECRET_CODE",
            "MANAGE_RESOURCES",
            "VIEW_ATTENDANCE_HISTORY",
            "MANAGE_ATTENDANCE_ACCESS"
    );

    private static final Map<String, List<String>> ROLE_PERMISSIONS = Map.ofEntries(
            Map.entry("MAKHDOM", List.of("VIEW_ATTENDANCE_HISTORY")),
            Map.entry("KHADIM", List.of(
                    "VIEW_ATTENDANCE", "TAKE_ATTENDANCE", "VIEW_FAMILY_INFO",
                    "MANAGE_IFTEKAD", "VIEW_ATTENDANCE_HISTORY")),
            Map.entry("AMIN_OSRA", List.of(
                    "VIEW_ATTENDANCE", "TAKE_ATTENDANCE", "VIEW_FAMILY_INFO",
                    "MANAGE_FAMILY_INFO", "MANAGE_IFTEKAD", "TRANSFER_MEMBERS",
                    "VIEW_ATTENDANCE_HISTORY")),
            Map.entry("AMIN_KHEDMA", List.of(
                    "VIEW_ATTENDANCE", "TAKE_ATTENDANCE", "VIEW_FAMILY_INFO",
                    "MANAGE_FAMILY_INFO", "MANAGE_EVENTS", "MANAGE_ANNOUNCEMENTS",
                    "MANAGE_IFTEKAD", "TRANSFER_MEMBERS", "MANAGE_ROLES",
                    "START_NEW_YEAR", "MANAGE_KHORS", "VIEW_GRADES",
                    "VIEW_ATTENDANCE_HISTORY", "MANAGE_ATTENDANCE_ACCESS")),
            Map.entry("DEVELOPER", ALL_PERMISSIONS)
    );

    private static final Map<String, String> ROLE_DISPLAY_NAMES = Map.of(
            "MAKHDOM", "مخدوم",
            "KHADIM", "خادم",
            "AMIN_OSRA", "أمين الأسرة",
            "AMIN_KHEDMA", "أمين الخدمة",
            "DEVELOPER", "مبرمج"
    );

    private static final List<String> DEFAULT_ORDER = List.of(
            "MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "DEVELOPER"
    );

    @PostConstruct
    public void seedRoles() {
        for (int i = 0; i < DEFAULT_ORDER.size(); i++) {
            String name = DEFAULT_ORDER.get(i);
            if (!repo.existsByName(name)) {
                RoleSettings role = RoleSettings.builder()
                        .name(name)
                        .displayNameAr(ROLE_DISPLAY_NAMES.getOrDefault(name, name))
                        .sortOrder(i)
                        .active(true)
                        .permissions(String.join(",", ROLE_PERMISSIONS.getOrDefault(name, List.of())))
                        .build();
                repo.save(role);
            }
        }
    }

    public List<RoleSettings> findAll() {
        return repo.findAllByOrderBySortOrderAsc();
    }

    public Optional<RoleSettings> findById(Long id) {
        return repo.findById(id);
    }

    public RoleSettings create(String name, String displayNameAr, String permissions) {
        RoleSettings role = RoleSettings.builder()
                .name(name.trim().toUpperCase())
                .displayNameAr(displayNameAr != null ? displayNameAr.trim() : name)
                .sortOrder((int) repo.findAllByOrderBySortOrderAsc().stream()
                        .mapToInt(RoleSettings::getSortOrder).max().orElse(0) + 10)
                .active(true)
                .permissions(permissions != null ? permissions.trim() : "")
                .build();
        return repo.save(role);
    }

    public RoleSettings update(Long id, String displayNameAr, Boolean active, String permissions) {
        RoleSettings role = repo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Role not found"));
        if (displayNameAr != null) role.setDisplayNameAr(displayNameAr.trim());
        if (active != null) role.setActive(active);
        if (permissions != null) role.setPermissions(permissions.trim());
        return repo.save(role);
    }

    public void delete(Long id) {
        RoleSettings role = repo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "NOT_FOUND", "Role not found"));
        repo.delete(role);
    }

    public void reorder(List<Long> ids) {
        for (int i = 0; i < ids.size(); i++) {
            Long id = ids.get(i);
            if (id == null) continue;
            final int order = i * 10;
            repo.findById(id).ifPresent(r -> {
                r.setSortOrder(order);
                repo.save(r);
            });
        }
    }
}
