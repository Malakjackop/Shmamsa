package com.shmamsa.service;

import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.util.JwtUtils;
import com.shmamsa.util.NationalIdUtils;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.*;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;
    private final EmailService emailService;

    private final ServantSecretService servantSecretService;


    private static class OtpData {
        String username;
        long expiresAt; // ms

        OtpData(String username, long expiresAt) {
            this.username = username;
            this.expiresAt = expiresAt;
        }
    private static class RateWindow {
        int count;
        long windowStartMs;

        RateWindow(int count, long windowStartMs) {
            this.count = count;
            this.windowStartMs = windowStartMs;
        }
    }

    }

    private final Map<String, OtpData> otpStore = new HashMap<>();
    private final Map<String, Long> otpTimestamps = new HashMap<>();
    private final Map<String, OtpData.RateWindow> hourlyRequests = new HashMap<>();

    private static final long OTP_TTL_MS = 5 * 60 * 1000;
    private static final long COOLDOWN_MS = 45_000;
    private static final int HOURLY_LIMIT = 5;


    public void register(RegisterRequest request) {
        if (request.getPassword() == null || !request.getPassword().equals(request.getConfirmPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_MISMATCH", "Passwords do not match");
        }

        userRepository.findByUsername(request.getUsername())
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "Username already in use");
                });

        userRepository.findByEmail(request.getEmail())
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "Email already in use");
                });

        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNationalId(request.getNationalId());
        user.setDeaconFamily(request.getDeaconFamily());
        user.setDeaconDegree(request.getDeaconDegree());
        user.setPhoneNumber(request.getPhoneNumber());
        user.setAddress(request.getAddress());
        user.setAddress(request.getAddress());
        user.setGuardiansPhone(request.getGuardiansPhone());
        user.setGuardianRelation(request.getGuardianRelation());
        user.setStatus(request.getStatus());
        user.setStudyType(request.getStudyType());

        user.setSchoolName(request.getSchoolName());
        user.setSchoolGrade(request.getSchoolGrade());

        user.setUniversityName(request.getUniversityName());
        user.setFaculty(request.getFaculty());
        user.setUniversityGrade(request.getUniversityGrade());

        user.setIsWorking(request.getIsWorking());
        user.setWorkDetails(request.getWorkDetails());

        user.setGraduatedFrom(request.getGraduatedFrom());
        user.setGraduateJob(request.getGraduateJob());


        LocalDate dob = NationalIdUtils.extractBirthDate(request.getNationalId());
        if (dob != null) user.setDateOfBirth(dob);
        String gender = NationalIdUtils.extractGender(request.getNationalId());
        if (gender != null) user.setGender(gender);

        user.setRole("MAKHDOM");

        userRepository.save(user);
    }


    public void registerServant(RegisterServantRequest request) {
        if (!servantSecretService.validateSecret(request.getSecret())) {
            throw new ApiException(HttpStatus.FORBIDDEN, "INVALID_SECRET", "Invalid registration secret");
        }


        if (request.getPassword() == null || !request.getPassword().equals(request.getConfirmPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_MISMATCH", "Passwords do not match");
        }

        userRepository.findByUsername(request.getUsername())
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "Username already in use");
                });

        userRepository.findByEmail(request.getEmail())
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "EMAIL_TAKEN", "Email already in use");
                });

        String nid = request.getNationalId().trim();

        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNationalId(nid);
        user.setDeaconFamily(request.getDeaconFamily());
        user.setDeaconDegree(request.getDeaconDegree());
        user.setRole("KHADIM");

        user.setPhoneNumber(request.getPhoneNumber());
        user.setAddress(request.getAddress());
        user.setGuardiansPhone(request.getGuardiansPhone());
        user.setGuardianRelation(request.getGuardianRelation());


        if (request.getDateOfBirth() != null && !request.getDateOfBirth().isBlank()) {
            try { user.setDateOfBirth(java.time.LocalDate.parse(request.getDateOfBirth().trim())); } catch (Exception ignored) {}
        }
        if (request.getGender() != null && !request.getGender().isBlank()) {
            user.setGender(request.getGender().trim());
        }
        if (user.getDateOfBirth() == null) {
            java.time.LocalDate dob = NationalIdUtils.extractBirthDate(nid);
            if (dob != null) user.setDateOfBirth(dob);
        }
        if (user.getGender() == null) {
            String g = NationalIdUtils.extractGender(nid);
            if (g != null) user.setGender(g);
        }

        user.setStatus(request.getStatus());
        user.setStudyType(request.getStudyType());

        user.setUniversityName(request.getUniversityName());
        user.setFaculty(request.getFaculty());
        user.setUniversityGrade(request.getUniversityGrade());

        user.setGraduatedFrom(request.getGraduatedFrom());
        user.setGraduateJob(request.getGraduateJob());

        user.setIsWorking(request.getIsWorking());
        user.setWorkDetails(request.getWorkDetails());


        userRepository.save(user);
    }



    public String login(String username, String password) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid username or password"));

        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid username or password");
        }

        return jwtUtils.generateToken(user.getUsername(), user.getRole());
    }


    public User getUserFromToken(String token) {
        String username = jwtUtils.extractUsername(token);
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found"));
    }


    public Map<String, Object> generateResetTokenByEmail(String email) {
        if (email == null || email.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "EMAIL_REQUIRED", "Email is required");
        }

        User user = userRepository.findByEmail(email.trim())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "EMAIL_NOT_FOUND", "No user found with this email"));

        sendOtpForUserByEmail(user);

        return Map.of("message", "OTP sent successfully to your email");
    }


    private void sendOtpForUserByEmail(User user) {
        String username = user.getUsername();
        long now = System.currentTimeMillis();

        // Cooldown
        if (otpTimestamps.containsKey(username)) {
            long lastSent = otpTimestamps.get(username);
            if (now - lastSent < COOLDOWN_MS) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "OTP_COOLDOWN", "Wait 45 seconds before requesting another code.");
            }
        }

        OtpData.RateWindow window = hourlyRequests.get(username);
        if (window == null || now - window.windowStartMs >= 3600_000) {
            window = new OtpData.RateWindow(0, now);
            hourlyRequests.put(username, window);
        }

        if (window.count >= HOURLY_LIMIT) {
            throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "OTP_LIMIT", "Too many OTP requests. Try again in 1 hour.");
        }

        window.count += 1;

        String code = String.format("%05d", new Random().nextInt(100000));

        otpStore.put(code, new OtpData(username, now + OTP_TTL_MS));

        otpTimestamps.put(username, now);

        emailService.sendOtpEmail(user.getEmail(), user.getFullName(), user.getUsername(), code);
    }


    public void resetPassword(String otp, String newPassword) {
        if (otp == null || otp.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "OTP_REQUIRED", "OTP is required");
        if (newPassword == null || newPassword.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_REQUIRED", "New password is required");

        OtpData data = otpStore.get(otp);
        if (data == null) throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_OTP", "Invalid or expired OTP");

        if (System.currentTimeMillis() > data.expiresAt) {
            otpStore.remove(otp);
            throw new ApiException(HttpStatus.BAD_REQUEST, "EXPIRED_OTP", "OTP expired");
        }

        String username = data.username;

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found"));

        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        otpStore.remove(otp);
    }


    public void purgeExpiredOtps() {
        long now = System.currentTimeMillis();

        otpStore.entrySet().removeIf(entry -> entry.getValue() == null || entry.getValue().expiresAt < now);
        otpTimestamps.entrySet().removeIf(e -> e.getValue() == null || now - e.getValue() > 10 * 60_000);

        hourlyRequests.entrySet().removeIf(e -> e.getValue() == null || now - e.getValue().windowStartMs > 2 * 3600_000);
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
