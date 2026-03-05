package com.shmamsa.repository;

import com.shmamsa.model.GradeSheet;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface GradeSheetRepository extends JpaRepository<GradeSheet, Long> {
    Optional<GradeSheet> findByFamilyBaseIgnoreCase(String familyBase);
}
