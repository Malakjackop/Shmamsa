package com.shmamsa.service;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;
    private final WhatsAppService whatsAppService;

    // OTP storage
    private final Map<String, String> otpUserMap = new HashMap<>();        // otp → username

    // OTP limits PER ACCOUNT (username)
    private final Map<String, Long> otpTimestamps = new HashMap<>();       // username → last OTP time
    private final Map<String, Integer> otpAttempts = new HashMap<>();      // username → failed attempts
    private final Map<String, Integer> hourlyRequests = new HashMap<>();   // username → OTP count last hour



    // -----------------------------------------------------------
    // REGISTER
    // -----------------------------------------------------------
    public void register(User user) {
        userRepository.findByUsername(user.getUsername())
                .ifPresent(existing -> {
                    throw new RuntimeException("Username already in use");
                });

        user.setPassword(passwordEncoder.encode(user.getPassword()));
        userRepository.save(user);
    }



    // -----------------------------------------------------------
    // LOGIN
    // -----------------------------------------------------------
    public String login(String username, String password) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new RuntimeException("Invalid username or password");
        }

        return jwtUtils.generateToken(user.getUsername());
    }



    // -----------------------------------------------------------
    // GET USER FROM JWT TOKEN
    // -----------------------------------------------------------
    public User getUserFromToken(String token) {
        String username = jwtUtils.extractUsername(token);
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }



    // -----------------------------------------------------------
    // GENERATE OTP FROM PHONE NUMBER
    // (Handles 1 user OR returns user list for selection)
    // -----------------------------------------------------------
    public Map<String, Object> generateResetToken(String phoneNumber) {

        // Find users matching phone number
        List<User> matches = userRepository.findAll().stream()
                .filter(u -> phoneNumber.equals(u.getPhoneNumber())
                        || phoneNumber.equals(u.getGuardiansPhone()))
                .toList();

        if (matches.isEmpty()) {
            throw new RuntimeException("No user found with this phone number");
        }

        // MULTIPLE USERS FOUND → return list to front-end
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

        // ONLY ONE USER
        User user = matches.get(0);
        String username = user.getUsername();
        long now = System.currentTimeMillis();

        // ---- 45 second cooldown per account ----
        if (otpTimestamps.containsKey(username)) {
            long lastSent = otpTimestamps.get(username);
            if (now - lastSent < 45_000) {
                throw new RuntimeException("Wait 45 seconds before requesting another code.");
            }
        }

        // ---- Hourly limit: Max 5 per account ----
        int count = hourlyRequests.getOrDefault(username, 0);
        if (count >= 5) {
            throw new RuntimeException("Too many OTP requests. Try again in 1 hour.");
        }
        hourlyRequests.put(username, count + 1);

        // Reset counter after 1 hour
        new Timer().schedule(new TimerTask() {
            @Override
            public void run() {
                hourlyRequests.remove(username);
            }
        }, 3600_000);

        // ---- Generate OTP ----
        String code = String.format("%05d", new Random().nextInt(100000));

        otpUserMap.put(code, username);
        otpTimestamps.put(username, now);
        otpAttempts.put(username, 0);

        // ---- Send via WhatsApp ----
        whatsAppService.sendResetCode(user, code);

        return Map.of(
                "multipleUsers", false,
                "message", "OTP sent successfully"
        );
    }



    // -----------------------------------------------------------
    // GENERATE OTP WHEN USER IS SELECTED FROM LIST
    // (Called when multiple users use the same phone number)
    // -----------------------------------------------------------
    public String generateResetTokenForUser(String phoneNumber, String username) {

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        // Validate phone belongs to this user
        if (!phoneNumber.equals(user.getPhoneNumber()) &&
                !phoneNumber.equals(user.getGuardiansPhone())) {
            throw new RuntimeException("Phone number does not belong to this user");
        }

        long now = System.currentTimeMillis();

        // 45-second cooldown
        if (otpTimestamps.containsKey(username)) {
            long lastSent = otpTimestamps.get(username);
            if (now - lastSent < 45_000) {
                throw new RuntimeException("Wait 45 seconds before requesting another code.");
            }
        }

        // Hourly limit
        int count = hourlyRequests.getOrDefault(username, 0);
        if (count >= 5) {
            throw new RuntimeException("Too many OTP requests. Try again in 1 hour.");
        }
        hourlyRequests.put(username, count + 1);

        // Auto-reset limit
        new Timer().schedule(new TimerTask() {
            @Override
            public void run() {
                hourlyRequests.remove(username);
            }
        }, 3600_000);

        // Generate OTP
        String code = String.format("%05d", new Random().nextInt(100000));

        otpUserMap.put(code, username);
        otpTimestamps.put(username, now);
        otpAttempts.put(username, 0);

        whatsAppService.sendResetCode(user, code);

        return code;
    }



    // -----------------------------------------------------------
    // VERIFY OTP
    // -----------------------------------------------------------
    public void verifyOtp(String otp) {

        String username = otpUserMap.get(otp);

        if (username == null) {
            throw new RuntimeException("Invalid or expired OTP");
        }

        int attempts = otpAttempts.getOrDefault(username, 0);

        if (attempts >= 5) {
            throw new RuntimeException("Too many failed attempts. Try again later.");
        }

        // OTP is correct → reset attempts
        otpAttempts.remove(username);
    }



    // -----------------------------------------------------------
    // RESET PASSWORD
    // -----------------------------------------------------------
    public void resetPassword(String otp, String newPassword) {

        String username = otpUserMap.get(otp);

        if (username == null)
            throw new RuntimeException("Invalid or expired OTP");

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        // Clear OTP
        otpUserMap.remove(otp);

        // Send confirmation message
        whatsAppService.sendPasswordChangedMessage(user);
    }



    // -----------------------------------------------------------
    // FIND USER BY USERNAME (Controller uses this)
    // -----------------------------------------------------------
    public User findByUsername(String username) {
        return userRepository.findByUsername(username).orElse(null);
    }

    // -----------------------------------------------------------
// SAVE USER (USED BY CONTROLLER)
// -----------------------------------------------------------
    public void saveUser(User user) {
        userRepository.save(user);
    }

}
