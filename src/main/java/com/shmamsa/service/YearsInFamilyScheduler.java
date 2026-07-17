package com.shmamsa.service;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.Map;

@Slf4j
@Component
@RequiredArgsConstructor
public class YearsInFamilyScheduler {

    private static final Map<String, String> NEXT_YEAR = Map.of(
            "اول سنه ليا", "سنتين",
            "سنتين", "٣ سنين",
            "٣ سنين", "٤ سنين",
            "٤ سنين", "اكتر من ٤ سنين"
    );

    private final UserRepository userRepo;

    @Scheduled(cron = "0 0 0 1 10 *")
    @Transactional
    public void incrementYearsInFamily() {
        log.info("Starting yearly yearsInFamily increment...");
        LocalDate cutoff = LocalDate.now().minusMonths(4);
        int updated = 0;
        int skipped = 0;
        for (User u : userRepo.findAll()) {
            String current = u.getYearsInFamily();
            if (current == null || current.isBlank()) continue;
            LocalDate transferDate = u.getFamilyTransferDate();
            if (transferDate != null && transferDate.isAfter(cutoff)) {
                skipped++;
                continue;
            }
            String next = NEXT_YEAR.get(current);
            if (next != null) {
                u.setYearsInFamily(next);
                updated++;
            }
        }
        if (updated > 0) {
            userRepo.flush();
        }
        log.info("YearsInFamily increment completed. Updated {} users, skipped {} (transferred within 4 months).", updated, skipped);
    }

    @Transactional
    public void resetYearsInFamily() {
        log.info("Resetting all yearsInFamily to null...");
        int count = 0;
        for (User u : userRepo.findAll()) {
            if (u.getYearsInFamily() != null && !u.getYearsInFamily().isBlank()) {
                u.setYearsInFamily(null);
                count++;
            }
        }
        if (count > 0) {
            userRepo.flush();
        }
        log.info("Reset completed. Cleared {} users.", count);
    }
}
