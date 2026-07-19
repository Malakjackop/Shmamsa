package com.shmamsa.service;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceSchedule;
import com.shmamsa.model.AttendanceStatus;
import com.shmamsa.model.AttendanceType;
import com.shmamsa.model.User;
import com.shmamsa.repository.AttendanceRepository;
import com.shmamsa.repository.AttendanceScheduleRepository;
import com.shmamsa.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class AttendanceScheduleService {

    private static final Logger log = LoggerFactory.getLogger(AttendanceScheduleService.class);

    private final AttendanceScheduleRepository scheduleRepo;
    private final AttendanceRepository attendanceRepo;
    private final FamilyAccessService familyAccessService;
    private final UserRepository userRepo;
    private final TimeProvider timeProvider;

    @Scheduled(cron = "0 0 * * * *")
    @Transactional
    public void autoGenerateToday() {
        LocalDate today = timeProvider.localDate();
        int dayOfWeek = today.getDayOfWeek().getValue() % 7;
        generateForDay(today, dayOfWeek);
    }

    public int generateForDay(LocalDate date, int dayOfWeek) {
        List<AttendanceSchedule> schedules = scheduleRepo.findByDayOfWeekAndEnabledTrue(dayOfWeek);
        if (schedules.isEmpty()) return 0;

        int totalCreated = 0;
        for (AttendanceSchedule sched : schedules) {
            totalCreated += generateForSchedule(sched, date);
        }
        return totalCreated;
    }

    public int generateForSchedule(AttendanceSchedule sched, LocalDate date) {
        String familyBase = sched.getFamilyBase();
        AttendanceType type = sched.getType();

        List<Long> userIds = familyAccessService.relatedIdsForSelection(familyBase);
        if (userIds == null || userIds.isEmpty()) return 0;

        int created = 0;
        for (Long uid : userIds) {
            if (uid == null) continue;
            boolean hasRecord = attendanceRepo.existsByUser_IdAndDateAndTypeAndArchivedFalse(uid, date, type);
            if (!hasRecord) {
                User user = userRepo.findById(uid).orElse(null);
                if (user == null) continue;

                AttendanceRecord r = new AttendanceRecord();
                r.setUser(user);
                r.setDate(date);
                r.setTime(timeProvider.localTime());
                r.setType(type);
                r.setStatus(AttendanceStatus.ABSENT);
                r.setFamilyBase(familyBase);
                attendanceRepo.save(r);
                created++;
            }
        }

        if (created > 0) {
            log.info("Auto-generated {} ABSENT records for family={} type={} date={}",
                    created, familyBase, type, date);
        }

        return created;
    }
}
