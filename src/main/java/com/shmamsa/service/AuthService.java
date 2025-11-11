package com.shmamsa.service;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Random;
import java.util.List;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;
    private final WhatsAppService whatsAppService;

    // Temporary in-memory store for reset tokens (for demo)
    private final Map<String, String> resetTokens = new HashMap<>();

    // ✅ Register new user
    public void register(User user) {
        userRepository.findByUsername(user.getUsername())
                .ifPresent(existing -> {
                    throw new RuntimeException("Username already in use");
                });

        user.setPassword(passwordEncoder.encode(user.getPassword()));
        userRepository.save(user);
    }

    // ✅ Login user and return JWT token
    public String login(String username, String password) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new RuntimeException("Invalid username or password");
        }

        return jwtUtils.generateToken(user.getUsername());
    }

    // ✅ Decode token and return user
    public User getUserFromToken(String token) {
        String username = jwtUtils.extractUsername(token);
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    // ✅ Helper method for cleaner profile endpoint
    public User findByUsername(String username) {
        return userRepository.findByUsername(username).orElse(null);
    }

    // ✅ Generate reset token and send via WhatsApp (simulation mode for now)
    public Map<String, Object> generateResetToken(String phoneNumber) {
        // Find all users with this phone (either personal or guardian)
        List<User> matches = userRepository.findAll().stream()
                .filter(u -> phoneNumber.equals(u.getPhoneNumber()) || phoneNumber.equals(u.getGuardiansPhone()))
                .toList();

        if (matches.isEmpty()) {
            throw new RuntimeException("No user found with this number");
        }

        // If multiple users share same guardian phone — ask frontend to choose
        if (matches.size() > 1) {
            List<Map<String, String>> usersList = matches.stream()
                    .map(u -> Map.of(
                            "username", u.getUsername(),
                            "fullName", u.getFullName(),
                            "deaconFamily", u.getDeaconFamily()
                    ))
                    .toList();

            return Map.of(
                    "multipleUsers", true,
                    "users", usersList
            );
        }

        // ✅ Otherwise, generate the reset code directly
        User user = matches.get(0);
        String code = String.format("%05d", new Random().nextInt(100000));
        resetTokens.put(code, user.getUsername());
        whatsAppService.sendResetCode(user, code);

        return Map.of(
                "multipleUsers", false,
                "code", code,
                "message", "Reset code sent successfully"
        );
    }

    public String generateResetTokenForUser(String phoneNumber, String username) {
        User user = userRepository.findByUsername(username)
                .filter(u -> phoneNumber.equals(u.getPhoneNumber()) || phoneNumber.equals(u.getGuardiansPhone()))
                .orElseThrow(() -> new RuntimeException("User not found for this number"));

        String code = String.format("%05d", new Random().nextInt(100000));
        resetTokens.put(code, username);
        whatsAppService.sendResetCode(user, code);

        return code;
    }



    // ✅ Reset password using token
    public void resetPassword(String token, String newPassword) {
        String username = resetTokens.get(token);
        if (username == null) {
            throw new RuntimeException("Invalid or expired reset token");
        }

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        // Update password
        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        // Remove token after successful reset
        resetTokens.remove(token);
    }

    public void saveUser(User user) {
        userRepository.save(user);
    }

}
