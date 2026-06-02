package com.shmamsa.repository;

import com.shmamsa.model.AttendanceSchedule;
import com.shmamsa.model.AttendanceType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AttendanceScheduleRepository extends JpaRepository<AttendanceSchedule, Long> {

    List<AttendanceSchedule> findByFamilyBaseIn(List<String> familyBases);

    List<AttendanceSchedule> findByFamilyBase(String familyBase);

    List<AttendanceSchedule> findByDayOfWeekAndEnabledTrue(Integer dayOfWeek);

    Optional<AttendanceSchedule> findByFamilyBaseAndTypeAndDayOfWeek(String familyBase, AttendanceType type, Integer dayOfWeek);
}
