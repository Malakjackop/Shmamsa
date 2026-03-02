package com.shmamsa.repository;

import com.shmamsa.model.EventParticipant;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface EventParticipantRepository extends JpaRepository<EventParticipant, Long> {

    boolean existsByEvent_IdAndUser_Id(Long eventId, Long userId);

    long countByEvent_Id(Long eventId);

    void deleteByEvent_IdAndUser_Id(Long eventId, Long userId);

    List<EventParticipant> findByEvent_Id(Long eventId);
}