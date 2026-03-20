package com.shmamsa.config;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
public class DevAccountSeeder implements CommandLineRunner {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;

    @Value("${app.dev.enabled:true}")
    private boolean enabled;

    @Value("${app.dev.username:developer}")
    private String devUsername;

    @Value("${app.dev.password:developer@2026}")
    private String devPassword;

    @Override
    public void run(String... args) {
        if (!enabled) return;

        userRepository.findByUsername(devUsername).ifPresentOrElse(
                u -> {}, // already exists
                () -> {
                    User dev = new User();
                    dev.setFullName("System Developer");
                    dev.setUsername(devUsername);
                    dev.setEmail("developer@system.local");
                    dev.setPassword(passwordEncoder.encode(devPassword));

                    // required fields on entity
                    dev.setNationalId("99999999999999");
                    dev.setDeaconDegree("SYSTEM");

                    dev.setRole("DEVELOPER");

                    userRepository.save(dev);
                }
        );
    }
}
