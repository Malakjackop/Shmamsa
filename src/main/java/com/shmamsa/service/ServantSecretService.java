package com.shmamsa.service;

import com.shmamsa.model.ServantRegistrationSecret;
import com.shmamsa.repository.ServantRegistrationSecretRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class ServantSecretService {

    private final ServantRegistrationSecretRepository repo;
    private final BCryptPasswordEncoder encoder;

    @Value("${app.servant-secret-ttl-hours:24}")
    private long ttlHours;

    private static final SecureRandom RNG = new SecureRandom();
    private static final String CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#";

    public Map<String, Object> generateSecretForDev() {
        String raw = generateSecret(16);
        LocalDateTime from = LocalDateTime.now();
        LocalDateTime to = from.plusHours(ttlHours);

        ServantRegistrationSecret row = new ServantRegistrationSecret();
        row.setSecretHash(encoder.encode(raw));
        row.setSecretPlain(raw);
        row.setValidFrom(from);
        row.setValidTo(to);

        repo.save(row);

        return Map.of(
                "code", raw,
                "validFrom", from.toString(),
                "validTo", to.toString(),
                "valid", true
        );
    }

    public Map<String, Object> getCurrentSecretForDev() {
        var current = repo.findTopByOrderByValidToDesc().orElse(null);
        if (current == null || current.getSecretPlain() == null) {
            return null;
        }
        boolean valid = LocalDateTime.now().isBefore(current.getValidTo());
        return Map.of(
                "code", current.getSecretPlain(),
                "validFrom", current.getValidFrom().toString(),
                "validTo", current.getValidTo().toString(),
                "valid", valid
        );
    }

    public boolean validateSecret(String input) {
        var current = repo.findFirstByValidToAfterOrderByValidToDesc(LocalDateTime.now())
                .orElse(null);

        if (current == null) {
            return false;
        }

        return encoder.matches(input, current.getSecretHash());
    }

    private void rotateSecretAndEmail() {
        String raw = generateSecret(16);

        LocalDateTime from = LocalDateTime.now();
        LocalDateTime to = from.plusHours(ttlHours);

        ServantRegistrationSecret row = new ServantRegistrationSecret();
        row.setSecretHash(encoder.encode(raw));
        row.setSecretPlain(raw);
        row.setValidFrom(from);
        row.setValidTo(to);

        repo.save(row);
    }

    private String generateSecret(int len) {
        StringBuilder sb = new StringBuilder(len);
        for (int i = 0; i < len; i++) {
            sb.append(CHARS.charAt(RNG.nextInt(CHARS.length())));
        }
        return sb.toString();
    }
}
