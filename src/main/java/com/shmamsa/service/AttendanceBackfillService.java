package com.shmamsa.service;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceStatus;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.model.UserFamilyAssignmentView;
import com.shmamsa.repository.AttendanceRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class AttendanceBackfillService {

    private final AttendanceRepository attendanceRepo;
    private final FamilyAccessService familyAccessService;
    private final UserFamilyRoleService userFamilyRoleService;

    public void backfillForUser(User user) {
        if (user == null || user.getId() == null) return;

        for (String familyBase : assignedFamilyBases(user)) {
            backfillFamilyScoped(user, familyBase, AttendanceType.FAMILY_MEETING);
        }

        backfillGlobal(user, AttendanceType.FRIDAY_LITURGY);
        backfillGlobal(user, AttendanceType.TASBEEHA);

        for (String choirBase : assignedChoirBases(user)) {
            if ("خورس مارمرقس".equals(choirBase)) {
                backfillFamilyScoped(user, choirBase, AttendanceType.MARMARKOS_KHORS);
            } else if ("خورس البابا اثناسيوس".equals(choirBase)) {
                backfillFamilyScoped(user, choirBase, AttendanceType.ATHANASIUS_KHORS);
            }
        }
    }

    private void backfillFamilyScoped(User user, String familyBase, AttendanceType type) {
        if (familyBase == null || familyBase.isBlank()) return;
        Long familyId = familyAccessService.familyIdForName(familyBase);
        if (familyId == null) return;

        List<java.time.LocalDate> dates = attendanceRepo.findDistinctDatesByTypeAndFamilyIdAndArchivedFalse(type, familyId);
        for (java.time.LocalDate date : dates) {
            AttendanceRecord existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndFamilyIdAndArchivedFalse(
                    user.getId(), date, type, familyId
            );
            if (existing != null) continue;

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(user);
            r.setDate(date);
            r.setTime(LocalTime.MIDNIGHT);
            r.setType(type);
            r.setFamilyId(familyId);
            r.setFamilyBase(familyBase);
            r.setStatus(AttendanceStatus.ABSENT);
            attendanceRepo.save(r);
        }
    }

    private void backfillGlobal(User user, AttendanceType type) {
        List<java.time.LocalDate> dates = attendanceRepo.findDistinctDatesByTypeAndArchivedFalse(type);
        for (java.time.LocalDate date : dates) {
            AttendanceRecord existing = attendanceRepo.findFirstByUser_IdAndDateAndTypeAndArchivedFalse(
                    user.getId(), date, type
            );
            if (existing != null) continue;

            AttendanceRecord r = new AttendanceRecord();
            r.setUser(user);
            r.setDate(date);
            r.setTime(LocalTime.MIDNIGHT);
            r.setType(type);
            r.setStatus(AttendanceStatus.ABSENT);
            attendanceRepo.save(r);
        }
    }

    private List<String> assignedFamilyBases(User user) {
        Set<String> set = new LinkedHashSet<>();
        for (UserFamilyAssignmentView assignment : userFamilyRoleService.getAssignments(user)) {
            addFamilyBase(set, assignment.getFamilyId(), assignment.getFamilyName());
        }
        set.remove("خورس مارمرقس");
        set.remove("خورس البابا اثناسيوس");
        return new ArrayList<>(set);
    }

    private List<String> assignedChoirBases(User user) {
        Set<String> set = new LinkedHashSet<>();
        for (UserFamilyAssignmentView assignment : userFamilyRoleService.getAssignments(user)) {
            addChoirBase(set, assignment.getFamilyId(), assignment.getFamilyName());
        }

        addChoirMembership(set, user.getKhors());
        addChoirMembership(set, user.getAttendKhors());
        return new ArrayList<>(set);
    }

    private void addFamilyBase(Set<String> set, Long familyId, String family) {
        String base = familyAccessService.baseNameForId(familyId, family);
        if (base == null || base.isBlank() || "SYSTEM".equalsIgnoreCase(base)) return;
        set.add(base);
    }

    private void addChoirBase(Set<String> set, Long familyId, String family) {
        String base = familyAccessService.baseNameForId(familyId, family);
        if (base == null || base.isBlank()) return;
        if ("خورس مارمرقس".equals(base) || "خورس البابا اثناسيوس".equals(base)) {
            set.add(base);
        }
    }

    private void addChoirMembership(Set<String> set, String raw) {
        String choir = normalizeChoirCode(raw);
        if ("MARMARKOS".equals(choir) || "BOTH".equals(choir)) set.add("خورس مارمرقس");
        if ("ATHANASIUS".equals(choir) || "BOTH".equals(choir)) set.add("خورس البابا اثناسيوس");
    }

    private String normalizeChoirCode(String raw) {
        String x = raw == null ? "" : raw.trim().toUpperCase();
        if (x.isBlank() || "NONE".equals(x)) return "";
        if (x.contains("BOTH")) return "BOTH";
        if (x.contains("MARMARKOS") || x.contains("مارمر") || x.contains("مرقس")) return "MARMARKOS";
        if (x.contains("ATHANASIUS") || x.contains("اثناس")) return "ATHANASIUS";
        return x;
    }
}
