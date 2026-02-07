package com.shmamsa.service;

import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Periodically cleans up in-memory OTP data to avoid memory growth.
 */
@Component
@RequiredArgsConstructor
public class OtpCleanupScheduler {

    private final AuthService authService;

    // every minute
    @Scheduled(fixedDelay = 60_000)
    public void cleanup() {
        authService.purgeExpiredOtps();
    }
}
