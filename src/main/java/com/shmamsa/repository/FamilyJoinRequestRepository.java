package com.shmamsa.repository;

import com.shmamsa.model.FamilyJoinRequest;
import com.shmamsa.model.FamilyJoinRequestStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface FamilyJoinRequestRepository extends JpaRepository<FamilyJoinRequest, Long> {
    List<FamilyJoinRequest> findByFamilyIdAndStatusOrderByCreatedAtAsc(Long familyId, FamilyJoinRequestStatus status);
    List<FamilyJoinRequest> findByStatusOrderByCreatedAtAsc(FamilyJoinRequestStatus status);
    Optional<FamilyJoinRequest> findByUserIdAndFamilyIdAndStatus(Long userId, Long familyId, FamilyJoinRequestStatus status);
    boolean existsByUserIdAndFamilyIdAndStatus(Long userId, Long familyId, FamilyJoinRequestStatus status);
    List<FamilyJoinRequest> findByUser_IdAndStatusNot(Long userId, FamilyJoinRequestStatus status);
}
