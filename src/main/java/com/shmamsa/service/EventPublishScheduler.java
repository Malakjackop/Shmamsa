package com.shmamsa.service;

import com.shmamsa.model.Event;
import com.shmamsa.model.EventStatus;
import com.shmamsa.repository.EventParticipantRepository;
import com.shmamsa.repository.EventRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

@Component
@RequiredArgsConstructor
public class EventPublishScheduler {

    private final EventRepository eventRepo;
    private final EventParticipantRepository participantRepo;

    // كل 10 دقائق
    @Scheduled(cron = "0 */10 * * * *")
    @Transactional
    public void autoCleanup() {
        LocalDate today = LocalDate.now();

        Set<Long> idsToDelete = new LinkedHashSet<>();

        List<Event> removeAtReached = eventRepo.findByRemoveAtLessThanEqual(today);
        for (Event e : removeAtReached) {
            if (e.getId() != null) idsToDelete.add(e.getId());
        }

        List<Event> pendingExpired = eventRepo.findByStatusAndEventAtBefore(EventStatus.PENDING, today);
        for (Event e : pendingExpired) {
            if (e.getId() != null) idsToDelete.add(e.getId());
        }

        if (idsToDelete.isEmpty()) return;

        for (Long id : new ArrayList<>(idsToDelete)) {
            participantRepo.deleteByEvent_Id(id);
            eventRepo.deleteById(id);
        }
    }
}