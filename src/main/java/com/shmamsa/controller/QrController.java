package com.shmamsa.controller;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.QrTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@RestController
@RequestMapping("/api/qr")
@RequiredArgsConstructor
public class QrController {

    private final QrTokenService qrTokenService;
    private final UserRepository userRepo;

    /**
     * Returns a signed QR token for the logged-in user.
     * The token can be screenshotted/printed and later scanned by servants.
     */
    @GetMapping("/me/token")
    public ResponseEntity<?> myToken(Authentication authentication) {
        if (authentication == null || !authentication.isAuthenticated()) {
            return ResponseEntity.status(401).body(Map.of("error", "User not authenticated"));
        }

        String username = authentication.getName();
        User u = userRepo.findByUsername(username).orElse(null);
        if (u == null) {
            return ResponseEntity.status(404).body(Map.of("error", "User not found"));
        }

        String token = qrTokenService.issueToken(u.getId());
        return ResponseEntity.ok(Map.of("token", token));
    }
}
