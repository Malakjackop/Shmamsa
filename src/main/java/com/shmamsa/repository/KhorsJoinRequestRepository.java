package com.shmamsa.repository;

import com.shmamsa.model.KhorsJoinRequest;
import com.shmamsa.model.KhorsJoinRequestStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;

public interface KhorsJoinRequestRepository extends JpaRepository<KhorsJoinRequest, Long> {

    Optional<KhorsJoinRequest> findFirstByUser_IdAndStatus(Long userId, KhorsJoinRequestStatus status);

    List<KhorsJoinRequest> findByStatus(KhorsJoinRequestStatus status);

    @Query("select r from KhorsJoinRequest r where r.status = :status and upper(r.requestedKhors) in :khors")
    List<KhorsJoinRequest> findByStatusAndRequestedKhorsIn(
            @Param("status") KhorsJoinRequestStatus status,
            @Param("khors") List<String> khors
    );

    long countByStatus(KhorsJoinRequestStatus status);

    @Query("select count(r) from KhorsJoinRequest r where r.status = :status and upper(r.requestedKhors) in :khors")
    long countByStatusAndRequestedKhorsIn(
            @Param("status") KhorsJoinRequestStatus status,
            @Param("khors") List<String> khors
    );

    @Query("select r from KhorsJoinRequest r join fetch r.user u where r.status = :status")
    List<KhorsJoinRequest> findByStatusFetchUser(@Param("status") KhorsJoinRequestStatus status);

    @Query("select r from KhorsJoinRequest r join fetch r.user u where r.status = :status and upper(r.requestedKhors) in :khors")
    List<KhorsJoinRequest> findByStatusAndRequestedKhorsInFetchUser(
            @Param("status") KhorsJoinRequestStatus status,
            @Param("khors") List<String> khors
    );
}
