package com.shmamsa.repository;

import com.shmamsa.model.CustomAttendanceEvent;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface CustomAttendanceEventRepository extends JpaRepository<CustomAttendanceEvent, Long> {
    @Override
    @EntityGraph(attributePaths = {"createdBy", "permittedEditors"})
    List<CustomAttendanceEvent> findAll();

    @Override
    @EntityGraph(attributePaths = {"createdBy", "permittedEditors"})
    java.util.Optional<CustomAttendanceEvent> findById(Long id);

    @EntityGraph(attributePaths = {"createdBy", "permittedEditors"})
    List<CustomAttendanceEvent> findByEnabledTrueOrderByDayOfWeekAscTitleAsc();

    @EntityGraph(attributePaths = {"createdBy", "permittedEditors"})
    List<CustomAttendanceEvent> findByFamilyBaseAndEnabledTrueOrderByDayOfWeekAscTitleAsc(String familyBase);

    @EntityGraph(attributePaths = {"createdBy", "permittedEditors"})
    List<CustomAttendanceEvent> findByFamilyBaseIsNullAndEnabledTrueOrderByDayOfWeekAscTitleAsc();

    @EntityGraph(attributePaths = {"createdBy", "permittedEditors"})
    List<CustomAttendanceEvent> findByOrderByDayOfWeekAscTitleAsc();
}
