package com.shmamsa.repository;

import com.shmamsa.model.Event;
import com.shmamsa.model.EventStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.LocalDate;
import java.util.List;

public interface EventRepository extends JpaRepository<Event, Long> {

    List<Event> findByEventAtGreaterThanEqualAndEventAtLessThan(LocalDate start, LocalDate end);

    List<Event> findByStatus(EventStatus status);
}