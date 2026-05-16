package com.shmamsa.service;

import com.shmamsa.model.ServantRegistrationSecret;
import com.shmamsa.repository.ServantRegistrationSecretRepository;
import jakarta.annotation.PostConstruct;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

@Service
@RequiredArgsConstructor
public class ServantSecretService {

    private final ServantRegistrationSecretRepository repo;
    private final BCryptPasswordEncoder encoder;
    private final EmailService emailService;

    @Value("${app.servant-secret-admin-email}")
    private String adminEmail;

    @Value("${app.servant-secret-ttl-hours:24}")
    private long ttlHours;

    private static final SecureRandom RNG = new SecureRandom();
    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#";

    @PostConstruct
    public void init() {
        try {
            ensureSecretExists();
        } catch (Exception e) {
            System.err.println("WARN: Could not initialize servant secret: " + e.getMessage());
        }
    }

    @Scheduled(cron = "0 0 0 * * *", zone = "Africa/Cairo")
    public void rotateDaily() {
        rotateSecretAndEmail();
    }

    public boolean validateSecret(String input) {
        var current = repo.findFirstByValidToAfterOrderByValidToDesc(LocalDateTime.now())
                .orElse(null);

        if (current == null) {
            rotateSecretAndEmail();
            current = repo.findFirstByValidToAfterOrderByValidToDesc(LocalDateTime.now()).orElse(null);
            if (current == null) return false;
        }

        return encoder.matches(input, current.getSecretHash());
    }

    private void ensureSecretExists() {
        boolean exists = repo.findFirstByValidToAfterOrderByValidToDesc(LocalDateTime.now()).isPresent();
        if (!exists) rotateSecretAndEmail();
    }

    private void rotateSecretAndEmail() {
        String raw = generateSecret(16);

        LocalDateTime from = LocalDateTime.now();
        LocalDateTime to = from.plusHours(ttlHours);

        ServantRegistrationSecret row = new ServantRegistrationSecret();
        row.setSecretHash(encoder.encode(raw));
        row.setValidFrom(from);
        row.setValidTo(to);

        repo.save(row);

        String validToText = to.format(DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm"));
        emailService.sendServantSecretEmail(adminEmail, raw, validToText);
    }

    private String generateSecret(int len) {
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) {
            sb.append(CHARS.charAt(RNG.nextInt(CHARS.length())));
        }
        return sb.toString();
    }
}
