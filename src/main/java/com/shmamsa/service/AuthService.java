package com.shmamsa.service;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;

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

    // ✅ Generate reset token (temporary in-memory storage)
    public String generateResetToken(String username) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        // Create reset token using JWT (or you can use UUID)
        String token = jwtUtils.generateToken(username);

        // Store token temporarily
        resetTokens.put(token, username);

        return token;
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
}
