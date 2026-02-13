
package com.shmamsa.repository;

import com.shmamsa.model.AttendanceRecord;
import com.shmamsa.model.AttendanceType;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface AttendanceRepository extends JpaRepository<AttendanceRecord, Long> {
    boolean existsByUser_IdAndDateAndType(Long userId, LocalDate date, AttendanceType type);
    List<AttendanceRecord> findByUser_IdOrderByCreatedAtDesc(Long userId);
    List<AttendanceRecord> findByUser_DeaconFamily(String deaconFamily);
    List<AttendanceRecord> findByDateAndType(LocalDate date, AttendanceType type);
    List<AttendanceRecord> findByUser_DeaconFamilyStartingWith(String prefix);

    // ✅ Dashboard stats (total attendance counts for the logged-in user)
    long countByUser_IdAndType(Long userId, AttendanceType type);
}
