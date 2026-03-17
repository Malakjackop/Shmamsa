package com.shmamsa.service;

import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.model.FamilyRoleCode;
import com.shmamsa.model.User;
import com.shmamsa.model.UserFamilyAssignmentView;
import com.shmamsa.model.UserFamilyRole;
import com.shmamsa.repository.UserFamilyRoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class UserFamilyRoleService {

    private final UserFamilyRoleRepository userFamilyRoleRepository;
    private final FamilyCatalogService familyCatalogService;

    public List<UserFamilyAssignmentView> getAssignments(User user) {
        if (user == null || user.getId() == null) return List.of();

        List<UserFamilyRole> rows = userFamilyRoleRepository.findByUser_IdOrderByAssignmentOrderAscIdAsc(user.getId());
        if (rows.isEmpty()) return List.of();

        List<UserFamilyAssignmentView> out = new ArrayList<>();
        for (UserFamilyRole row : rows) {
            Long familyId = row.getFamilyId();
            String familyName = resolveFamilyName(familyId, null);
            FamilyRoleCode code = FamilyRoleCode.fromCode(row.getRoleCode());
            out.add(UserFamilyAssignmentView.builder()
                    .familyId(familyId)
                    .familyName(familyName)
                    .roleCode(code.getCode())
                    .role(code.getRoleName())
                    .assignmentOrder(row.getAssignmentOrder())
                    .build());
        }
        return out;
    }

    public void syncUser(User user) {
        List<UserFamilyAssignmentView> assignments = getAssignments(user);
        applyLegacyFields(user, assignments);
        user.setFamilyAssignments(assignments);
    }

    @Transactional
    public void replaceAssignments(User user, List<UserFamilyAssignmentView> requestedAssignments) {
        if (user == null || user.getId() == null) return;

        List<UserFamilyAssignmentView> normalized = normalizeAssignments(requestedAssignments);
        userFamilyRoleRepository.deleteByUser_Id(user.getId());
        persistAssignments(user, normalized);
        applyLegacyFields(user, normalized);
    }

    public void syncAssignmentsFromLegacy(User user) {
        syncUser(user);
    }

    @Transactional
    public void deleteAssignments(User user) {
        if (user == null || user.getId() == null) return;
        userFamilyRoleRepository.deleteByUser_Id(user.getId());
    }

    private void persistAssignments(User user, List<UserFamilyAssignmentView> assignments) {
        if (assignments.isEmpty()) return;

        List<UserFamilyRole> rows = new ArrayList<>();
        for (UserFamilyAssignmentView assignment : assignments) {
            if (assignment.getFamilyId() == null) continue;
            rows.add(UserFamilyRole.builder()
                    .user(user)
                    .familyId(assignment.getFamilyId())
                    .roleCode(FamilyRoleCode.fromCode(assignment.getRoleCode()).getCode())
                    .assignmentOrder(assignment.getAssignmentOrder() == null ? rows.size() + 1 : assignment.getAssignmentOrder())
                    .build());
        }
        if (!rows.isEmpty()) userFamilyRoleRepository.saveAll(rows);
    }

    private List<UserFamilyAssignmentView> normalizeAssignments(List<UserFamilyAssignmentView> requestedAssignments) {
        Map<Long, UserFamilyAssignmentView> uniqueByFamily = new LinkedHashMap<>();
        if (requestedAssignments != null) {
            for (UserFamilyAssignmentView assignment : requestedAssignments) {
                if (assignment == null) continue;
                Long familyId = assignment.getFamilyId();
                String rawName = assignment.getFamilyName();
                if (familyId == null && (rawName == null || rawName.isBlank())) continue;

                FamilyCatalog family = resolveFamily(familyId, rawName);
                if (family == null) continue;

                Integer code = assignment.getRoleCode();
                if (code == null) code = FamilyRoleCode.fromRole(assignment.getRole()).getCode();

                uniqueByFamily.putIfAbsent(family.getId(), UserFamilyAssignmentView.builder()
                        .familyId(family.getId())
                        .familyName(family.getNameAr())
                        .roleCode(FamilyRoleCode.fromCode(code).getCode())
                        .role(FamilyRoleCode.fromCode(code).getRoleName())
                        .assignmentOrder(uniqueByFamily.size() + 1)
                        .build());
            }
        }
        return new ArrayList<>(uniqueByFamily.values());
    }

    private void applyLegacyFields(User user, List<UserFamilyAssignmentView> assignments) {
        List<UserFamilyAssignmentView> normalized = normalizeAssignments(assignments);
        user.setDeaconFamily(null);
        user.setDeaconFamilyId(null);
        user.setDeaconFamilyRole(null);
        user.setDeaconFamily2(null);
        user.setDeaconFamily2Id(null);
        user.setDeaconFamilyRole2(null);
        user.setDeaconFamily3(null);
        user.setDeaconFamily3Id(null);
        user.setDeaconFamilyRole3(null);
        user.setDeaconFamily4(null);
        user.setDeaconFamily4Id(null);
        user.setDeaconFamilyRole4(null);

        for (int i = 0; i < normalized.size() && i < 4; i++) {
            UserFamilyAssignmentView assignment = normalized.get(i);
            String familyName = resolveFamilyName(assignment.getFamilyId(), assignment.getFamilyName());
            String role = FamilyRoleCode.fromCode(assignment.getRoleCode()).getRoleName();
            if (i == 0) {
                user.setDeaconFamily(familyName);
                user.setDeaconFamilyId(assignment.getFamilyId());
                user.setDeaconFamilyRole(role);
            } else if (i == 1) {
                user.setDeaconFamily2(familyName);
                user.setDeaconFamily2Id(assignment.getFamilyId());
                user.setDeaconFamilyRole2(role);
            } else if (i == 2) {
                user.setDeaconFamily3(familyName);
                user.setDeaconFamily3Id(assignment.getFamilyId());
                user.setDeaconFamilyRole3(role);
            } else {
                user.setDeaconFamily4(familyName);
                user.setDeaconFamily4Id(assignment.getFamilyId());
                user.setDeaconFamilyRole4(role);
            }
        }
    }

    private FamilyCatalog resolveFamily(Long familyId, String fallbackName) {
        if (familyId != null) {
            FamilyCatalog family = familyCatalogService.findById(familyId);
            if (family != null) return family;
        }
        String raw = String.valueOf(fallbackName == null ? "" : fallbackName).trim();
        if (raw.isBlank() || "SYSTEM".equalsIgnoreCase(raw)) return null;
        return familyCatalogService.findByName(raw);
    }

    private String resolveFamilyName(Long familyId, String fallbackName) {
        FamilyCatalog family = resolveFamily(familyId, fallbackName);
        if (family != null && family.getNameAr() != null && !family.getNameAr().isBlank()) return family.getNameAr().trim();
        return String.valueOf(fallbackName == null ? "" : fallbackName).trim();
    }
}
