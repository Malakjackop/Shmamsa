package com.shmamsa.service;

import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import jakarta.validation.ValidationException;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.util.*;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;
    private final EmailService emailService;

    @Value("${app.servant-register-secret:CHANGE_ME}")
    private String servantRegisterSecret;

    // ===============================
    // OTP storage with expiry + user
    // ===============================
    private static class OtpData {
        String username;
        long expiresAt; // ms

        OtpData(String username, long expiresAt) {
            this.username = username;
            this.expiresAt = expiresAt;
        }
    }

    private final Map<String, OtpData> otpStore = new HashMap<>();         // otp -> data
    private final Map<String, Long> otpTimestamps = new HashMap<>();       // username -> last otp send time
    private final Map<String, Integer> hourlyRequests = new HashMap<>();   // username -> count last hour

    private static final long OTP_TTL_MS = 5 * 60 * 1000;   // 5 minutes
    private static final long COOLDOWN_MS = 45_000;         // 45 seconds
    private static final int HOURLY_LIMIT = 5;

    // -----------------------------------------------------------
    // REGISTER
    // -----------------------------------------------------------
    public void register(RegisterRequest request) {
        // check username
        userRepository.findByUsername(request.getUsername())
                .ifPresent(existing -> {
                    throw new RuntimeException("Username already in use");
                });

        // check email
        userRepository.findByEmail(request.getEmail())
                .ifPresent(existing -> {
                    throw new RuntimeException("Email already in use");
                });

        // convert DTO to User entity
        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNationalId(request.getNationalId());
        user.setDeaconFamily(request.getDeaconFamily());
        user.setDeaconDegree(request.getDeaconDegree());
        user.setPhoneNumber(request.getPhoneNumber());
        user.setGuardiansPhone(request.getGuardiansPhone());
        user.setGuardianRelation(request.getGuardianRelation());


        // Force default role
        user.setRole("MAKHDOM");

        userRepository.save(user);
    }

    // -----------------------------------------------------------
// REGISTER SERVANT (Special link)
// -----------------------------------------------------------
    public void registerServant(RegisterServantRequest request) {
        if (!servantRegisterSecret.equals(request.getSecret())) {
            throw new ValidationException("Invalid registration secret");
        }

        userRepository.findByUsername(request.getUsername())
                .ifPresent(existing -> {
                    throw new ValidationException("Username already in use");
                });

        userRepository.findByEmail(request.getEmail())
                .ifPresent(existing -> {
                    throw new ValidationException("Email already in use");
                });

        // Check national ID number + age + gender
        String nid = request.getNationalId().trim();

        if (!nid.matches("\\d{14}")) {
            throw new ValidationException("National ID must be 14 digits");
        }

        if (nid.matches("(\\d)\\1{13}")) {
            throw new ValidationException("Fake National ID: repeated digits");
        }


        int century = Integer.parseInt(nid.substring(0, 1));
        int year = (century == 2 ? 1900 : century == 3 ? 2000 : -1) + Integer.parseInt(nid.substring(1, 3));
        int month = Integer.parseInt(nid.substring(3, 5));
        int day = Integer.parseInt(nid.substring(5, 7));

        Calendar cal = Calendar.getInstance();
        cal.setLenient(false);
        cal.set(year, month - 1, day);
        try {
            cal.getTime();
        } catch (Exception e) {
            throw new ValidationException("Invalid birth date inside National ID");
        }

        // Age
        Calendar today = Calendar.getInstance();
        int age = today.get(Calendar.YEAR) - cal.get(Calendar.YEAR);
        if (today.get(Calendar.DAY_OF_YEAR) < cal.get(Calendar.DAY_OF_YEAR)) age--;
        if (age < 16) throw new ValidationException("Servant must be at least 16 years old");

        // Gender
        String gender = (Integer.parseInt(nid.substring(12, 13)) % 2 == 0) ? "Female" : "Male";

        // Convert DTO to Entity
        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNationalId(nid);
        user.setDeaconFamily(request.getDeaconFamily());
        user.setDeaconDegree(request.getDeaconDegree());
        user.setRole("KHADIM");

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

        return jwtUtils.generateToken(user.getUsername(), user.getRole());
    }

    // -----------------------------------------------------------
    // GET USER FROM TOKEN
    // -----------------------------------------------------------
    public User getUserFromToken(String token) {
        String username = jwtUtils.extractUsername(token);
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));
    }

    // -----------------------------------------------------------
    // FORGOT PASSWORD (Email)
    // -----------------------------------------------------------
    public Map<String, Object> generateResetTokenByEmail(String email) {
        if (email == null || email.isBlank()) {
            throw new RuntimeException("Email is required");
        }

        User user = userRepository.findByEmail(email.trim())
                .orElseThrow(() -> new RuntimeException("No user found with this email"));

        sendOtpForUserByEmail(user);

        return Map.of("message", "OTP sent successfully to your email");
    }

    // -----------------------------------------------------------
    // OTP send helper (limits + ttl) - EMAIL
    // -----------------------------------------------------------
    private void sendOtpForUserByEmail(User user) {
        String username = user.getUsername();
        long now = System.currentTimeMillis();

        // Cooldown
        if (otpTimestamps.containsKey(username)) {
            long lastSent = otpTimestamps.get(username);
            if (now - lastSent < COOLDOWN_MS) {
                throw new RuntimeException("Wait 45 seconds before requesting another code.");
            }
        }

        // Hourly limit
        int count = hourlyRequests.getOrDefault(username, 0);
        if (count >= HOURLY_LIMIT) {
            throw new RuntimeException("Too many OTP requests. Try again in 1 hour.");
        }
        hourlyRequests.put(username, count + 1);

        // auto reset hourly counter
        new Timer().schedule(new TimerTask() {
            @Override public void run() { hourlyRequests.remove(username); }
        }, 3600_000);

        // Generate OTP
        String code = String.format("%05d", new Random().nextInt(100000));

        // Store OTP with expiry
        otpStore.put(code, new OtpData(username, now + OTP_TTL_MS));

        otpTimestamps.put(username, now);

        // Send Email
        emailService.sendOtpEmail(user.getEmail(), user.getFullName(), user.getUsername(), code);

        // auto remove OTP after TTL
        new Timer().schedule(new TimerTask() {
            @Override public void run() { otpStore.remove(code); }
        }, OTP_TTL_MS);
    }

    // -----------------------------------------------------------
    // RESET PASSWORD (OTP + new pass)
    // -----------------------------------------------------------
    public void resetPassword(String otp, String newPassword) {
        if (otp == null || otp.isBlank()) throw new RuntimeException("OTP is required");
        if (newPassword == null || newPassword.isBlank()) throw new RuntimeException("New password is required");

        OtpData data = otpStore.get(otp);
        if (data == null) throw new RuntimeException("Invalid or expired OTP");

        if (System.currentTimeMillis() > data.expiresAt) {
            otpStore.remove(otp);
            throw new RuntimeException("OTP expired");
        }

        String username = data.username;

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new RuntimeException("User not found"));

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        otpStore.remove(otp);
    }

    public User findByUsername(String username) {
        return userRepository.findByUsername(username).orElse(null);
    }

    public void saveUser(User user) {
        userRepository.save(user);
    }


public boolean isEmailTakenByOther(String email, Long currentUserId) {
    return userRepository.findByEmail(email)
            .map(u -> !u.getId().equals(currentUserId))
            .orElse(false);
}
}
