package com.shmamsa.repository;

import com.shmamsa.model.AttendanceAccessGrant;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface AttendanceAccessGrantRepository extends JpaRepository<AttendanceAccessGrant, Long> {
    @EntityGraph(attributePaths = {"targetUser", "createdBy"})
    List<AttendanceAccessGrant> findByTargetUser_IdAndEnabledTrueOrderByStartsAtDesc(Long targetUserId);

    @EntityGraph(attributePaths = {"targetUser", "createdBy"})
    List<AttendanceAccessGrant> findByCreatedBy_IdOrderByCreatedAtDesc(Long createdByUserId);

    @EntityGraph(attributePaths = {"targetUser", "createdBy"})
    List<AttendanceAccessGrant> findByOrderByCreatedAtDesc();

    @EntityGraph(attributePaths = {"targetUser", "createdBy"})
    Optional<AttendanceAccessGrant> findDetailedById(Long id);
}