package com.shmamsa.repository;

import com.shmamsa.model.EventParticipant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface EventParticipantRepository extends JpaRepository<EventParticipant, Long> {

    boolean existsByEvent_IdAndUser_Id(Long eventId, Long userId);

    long countByEvent_Id(Long eventId);

    List<EventParticipant> findByEvent_Id(Long eventId);

    // ✅ إلغاء الانضمام
    @Modifying
    @Transactional
    void deleteByEvent_IdAndUser_Id(Long eventId, Long userId);

    // ✅ مسح كل المنضمين قبل حذف الإيفنت (FK)
    @Modifying
    @Transactional
    void deleteByEvent_Id(Long eventId);
}