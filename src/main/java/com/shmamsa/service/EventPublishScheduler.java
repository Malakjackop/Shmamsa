package com.shmamsa.service;

import com.shmamsa.model.Event;
import com.shmamsa.model.EventStatus;
import com.shmamsa.repository.EventParticipantRepository;
import com.shmamsa.repository.EventRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
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
        LocalDateTime now = LocalDateTime.now();

        Set<Long> idsToDelete = new LinkedHashSet<>();

        List<Event> removeAtReached = eventRepo.findByRemoveAtLessThanEqual(now);
        for (Event e : removeAtReached) {
            if (e.getId() != null) idsToDelete.add(e.getId());
        }

        List<Event> pendingExpired = eventRepo.findByStatusAndEventAtBefore(EventStatus.PENDING, now);
        for (Event e : pendingExpired) {
            if (e.getId() == null) continue;

            // Normal unpublished drafts can be removed when the event time passes.
            // Cancelled notices are also stored as PENDING for DB compatibility, so keep
            // them until the cancellation notice date has passed.
            if (e.getCancelledAt() == null) {
                idsToDelete.add(e.getId());
                continue;
            }

            if (e.getCancelNoticeUntil() == null || e.getCancelNoticeUntil().isBefore(now)) {
                idsToDelete.add(e.getId());
            }
        }

        // Backward compatibility: if any database already accepted CANCELLED records,
        // clean them up normally after the notice period.
        List<Event> cancelledExpired = eventRepo.findByStatusAndCancelNoticeUntilBefore(EventStatus.CANCELLED, now);
        for (Event e : cancelledExpired) {
            if (e.getId() != null) idsToDelete.add(e.getId());
        }

        if (idsToDelete.isEmpty()) return;

        for (Long id : new ArrayList<>(idsToDelete)) {
            participantRepo.deleteByEvent_Id(id);
            eventRepo.deleteById(id);
        }
    }
}