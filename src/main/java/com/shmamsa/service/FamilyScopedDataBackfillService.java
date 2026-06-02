package com.shmamsa.service;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.Event;
import com.shmamsa.model.GradeSheet;
import com.shmamsa.model.ResourceFile;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.EventRepository;
import com.shmamsa.repository.GradeSheetRepository;
import com.shmamsa.repository.ResourceFileRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class FamilyScopedDataBackfillService {

    private final AttendanceRepository attendanceRepository;
    private final GradeSheetRepository gradeSheetRepository;
    private final ResourceFileRepository resourceFileRepository;
    private final EventRepository eventRepository;
    private final FamilyAccessService familyAccessService;

    @Value("${app.backfill.family-scoped-on-startup:false}")
    private boolean backfillOnStartup;

    @PostConstruct
    public void backfill() {
        if (!backfillOnStartup) return;
        backfillAttendance();
        backfillGradeSheets();
        backfillResources();
        backfillEvents();
    }

    private void backfillAttendance() {
        for (AttendanceRecord record : attendanceRepository.findAll()) {
            Long resolvedId = resolvedFamilyId(record.getFamilyId(), record.getFamilyBase());
            String resolvedBase = resolvedFamilyName(resolvedId, record.getFamilyBase());
            if (same(record.getFamilyId(), resolvedId) && same(record.getFamilyBase(), resolvedBase)) continue;
            record.setFamilyId(resolvedId);
            record.setFamilyBase(resolvedBase);
            attendanceRepository.save(record);
        }
    }

    private void backfillGradeSheets() {
        for (GradeSheet sheet : gradeSheetRepository.findAll()) {
            Long resolvedId = resolvedFamilyId(sheet.getFamilyId(), sheet.getFamilyBase());
            String resolvedBase = resolvedFamilyName(resolvedId, sheet.getFamilyBase());
            if (same(sheet.getFamilyId(), resolvedId) && same(sheet.getFamilyBase(), resolvedBase)) continue;
            sheet.setFamilyId(resolvedId);
            sheet.setFamilyBase(resolvedBase);
            gradeSheetRepository.save(sheet);
        }
    }

    private void backfillResources() {
        for (ResourceFile file : resourceFileRepository.findAll()) {
            if ("ALL".equalsIgnoreCase(String.valueOf(file.getFamily() == null ? "" : file.getFamily()).trim())) continue;
            Long resolvedId = resolvedFamilyId(file.getFamilyId(), file.getFamily());
            String resolvedName = familyAccessService.familyNameForId(resolvedId, file.getFamily());
            if (same(file.getFamilyId(), resolvedId) && same(file.getFamily(), resolvedName)) continue;
            file.setFamilyId(resolvedId);
            file.setFamily(resolvedName);
            resourceFileRepository.save(file);
        }
    }

    private void backfillEvents() {
        for (Event item : eventRepository.findAll()) {
            Long resolvedId = resolvedTargetFamilyId(item.getTargetFamilyId(), item.getTargetFamily());
            String resolvedName = resolvedTargetFamilyName(resolvedId, item.getTargetFamily());
            if (same(item.getTargetFamilyId(), resolvedId) && same(item.getTargetFamily(), resolvedName)) continue;
            item.setTargetFamilyId(resolvedId);
            item.setTargetFamily(resolvedName);
            eventRepository.save(item);
        }
    }

    private Long resolvedFamilyId(Long currentId, String fallbackName) {
        if (currentId != null) return currentId;
        return familyAccessService.familyIdForName(fallbackName);
    }

    private Long resolvedTargetFamilyId(Long currentId, String fallbackName) {
        if (currentId != null) return currentId;
        if ("ALL".equalsIgnoreCase(String.valueOf(fallbackName == null ? "" : fallbackName).trim())) return null;
        return familyAccessService.familyIdForName(fallbackName);
    }

    private String resolvedFamilyName(Long familyId, String fallbackName) {
        if (familyId == null) return fallbackName;
        return familyAccessService.baseNameForId(familyId, fallbackName);
    }

    private String resolvedTargetFamilyName(Long familyId, String fallbackName) {
        String raw = String.valueOf(fallbackName == null ? "" : fallbackName).trim();
        if ("ALL".equalsIgnoreCase(raw)) return "ALL";
        if (familyId == null) return raw;
        return familyAccessService.baseNameForId(familyId, fallbackName);
    }

    private boolean same(Object a, Object b) {
        return a == null ? b == null : a.equals(b);
    }
}
