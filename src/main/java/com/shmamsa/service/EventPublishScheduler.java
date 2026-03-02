package com.shmamsa.service;

import com.shmamsa.model.Event;
import com.shmamsa.model.EventStatus;
import com.shmamsa.repository.EventRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;

@Component
@RequiredArgsConstructor
public class EventPublishScheduler {

    private final EventRepository eventRepo;

    // كل 10 دقائق
    @Scheduled(cron = "0 */10 * * * *")
    public void autoPublish() {

        LocalDateTime now = LocalDateTime.now();
        LocalDate today = now.toLocalDate();
        List<Event> pending = eventRepo.findByStatus(EventStatus.PENDING);

        for (Event e : pending) {
            if (e.getEventAt() == null) continue;

            boolean shouldPublish = false;

            // 1) لو publishAt محدد واتعدّى => publish
            if (e.getPublishAt() != null && !e.getPublishAt().isAfter(today)) {
                shouldPublish = true;
            }

            // 2) لو مفيش publishAt => قبل الإيفنت بـ 4 أيام publish تلقائي
            if (e.getPublishAt() == null) {
                // eventAt <= today + 4 days
                if (!e.getEventAt().isAfter(today.plusDays(4))) {
                    shouldPublish = true;
                }
            }

            if (shouldPublish) {
                e.setStatus(EventStatus.PUBLISHED);
                e.setPublishedAt(now);
                eventRepo.save(e);
            }
        }
    }
}