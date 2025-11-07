package com.shmamsa.service;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;

    // ✅ Register new user
    public void register(User user) {
        userRepository.findByUsername(user.getUsername())
                .ifPresent(existing -> {
                    throw new RuntimeException("Username already in use");
                });

        user.setPassword(passwordEncoder.encode(user.getPassword()));
        userRepository.save(user);
    }

    // ✅ Login user and return token
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
}
