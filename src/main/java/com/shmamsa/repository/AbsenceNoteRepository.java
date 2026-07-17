package com.shmamsa.repository;

import com.shmamsa.model.AbsenceNote;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface AbsenceNoteRepository extends JpaRepository<AbsenceNote, Long> {

    Optional<AbsenceNote> findByMemberIdAndDateAndAttendanceType(Long memberId, LocalDate date, String attendanceType);

    List<AbsenceNote> findByFamilyBaseAndDate(String familyBase, LocalDate date);
}
