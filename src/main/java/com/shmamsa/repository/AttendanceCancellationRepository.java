package com.shmamsa.repository;

import com.shmamsa.model.AttendanceCancellation;
import com.shmamsa.model.AttendanceType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.List;

public interface AttendanceCancellationRepository extends JpaRepository<AttendanceCancellation, Long> {

    boolean existsByDateAndTypeAndFamilyBase(LocalDate date, AttendanceType type, String familyBase);

    List<AttendanceCancellation> findByDateAndType(LocalDate date, AttendanceType type);

    List<AttendanceCancellation> findByDateAndTypeAndFamilyBaseIn(LocalDate date, AttendanceType type, List<String> familyBases);

    List<AttendanceCancellation> findByDateBetweenAndTypeAndFamilyBaseIn(LocalDate from, LocalDate to, AttendanceType type, List<String> familyBases);

    @Modifying
    @Transactional
    long deleteByDateAndTypeAndFamilyBaseIn(LocalDate date, AttendanceType type, List<String> familyBases);
}
