package com.shmamsa.repository;

import com.shmamsa.model.IftekadVisit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

public interface IftekadVisitRepository extends JpaRepository<IftekadVisit, Long> {

    interface LastVisitProjection {
        Long getMemberId();
        LocalDate getLastDate();
    }

    @Query("select v.member.id as memberId, max(v.visitDate) as lastDate " +
            "from IftekadVisit v " +
            "where v.member.id in :ids " +
            "group by v.member.id")
    List<LastVisitProjection> findLastVisitDates(@Param("ids") List<Long> ids);

    @Query("select v from IftekadVisit v " +
            "join fetch v.recordedBy rb " +
            "where v.member.id = :memberId " +
            "order by v.visitDate desc, v.createdAt desc")
    List<IftekadVisit> findByMemberIdWithRecordedByOrderByVisitDateDesc(@Param("memberId") Long memberId);

    @Query("select v from IftekadVisit v " +
            "join fetch v.member m " +
            "join fetch v.recordedBy rb " +
            "where v.id = :id")
    Optional<IftekadVisit> findByIdWithMemberAndRecordedBy(@Param("id") Long id);
}