package com.shmamsa.repository;

import com.shmamsa.model.EventParticipant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

public interface EventParticipantRepository extends JpaRepository<EventParticipant, Long> {

    boolean existsByEvent_IdAndUser_Id(Long eventId, Long userId);

    long countByEvent_Id(Long eventId);

    List<EventParticipant> findByEvent_Id(Long eventId);

    // ✅ عشان إلغاء الانضمام يشتغل ويعمل commit
    @Transactional
    void deleteByEvent_IdAndUser_Id(Long eventId, Long userId);

    // ✅ عشان مسح الإيفنت يشتغل حتى لو فيه منضمين
    @Transactional
    void deleteByEvent_Id(Long eventId);
}