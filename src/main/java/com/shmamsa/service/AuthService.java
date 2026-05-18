package com.shmamsa.service;

import com.shmamsa.dto.RegisterRequest;
import com.shmamsa.dto.RegisterServantRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.model.UserFamilyAssignmentView;
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
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;
    private final EmailService emailService;

    private final KhorsJoinRequestService khorsJoinRequestService;
    private final AttendanceBackfillService attendanceBackfillService;

    private final ServantSecretService servantSecretService;
    private final FamilyCatalogService familyCatalogService;
    private final UserFamilyRoleService userFamilyRoleService;
    private final FamilyJoinRequestService familyJoinRequestService;

    private static class RateWindow {
        int count;
        long windowStartMs;

        RateWindow(int count, long windowStartMs) {
            this.count = count;
            this.windowStartMs = windowStartMs;
        }
    }


    private static class OtpData {
        String username;
        long expiresAt;

        OtpData(String username, long expiresAt) {
            this.username = username;
            this.expiresAt = expiresAt;
        }
    }

    private final Map<String, OtpData> otpStore = new ConcurrentHashMap<>();
    private final Map<String, Long> otpTimestamps = new ConcurrentHashMap<>();
    private final Map<String, RateWindow> hourlyRequests = new ConcurrentHashMap<>();

    private static final long OTP_TTL_MS = 5 * 60 * 1000;
    private static final long COOLDOWN_MS = 45_000;
    private static final int HOURLY_LIMIT = 5;


    private static final Set<String> KHORS_VALUES = Set.of("MARMARKOS", "ATHANASIUS", "BOTH", "NONE");
    private static final Set<String> ATTEND_KHORS_VALUES = Set.of("MARMARKOS", "ATHANASIUS", "NONE");

    private String normalizeKhors(String v, boolean allowBoth) {
        String x = (v == null) ? "" : v.trim().toUpperCase(Locale.ROOT);
        if (x.isBlank()) return "NONE";
        if (!KHORS_VALUES.contains(x)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_KHORS", "Invalid khors value");
        }
        if (!allowBoth && "BOTH".equals(x)) return "NONE";
        return x;
    }

    private String normalizeServingScope(String v) {
        String x = (v == null) ? "" : v.trim().toUpperCase(Locale.ROOT);
        return x.isBlank() ? "" : x;
    }

    private String normalizeAttendKhors(String v) {
        String x = (v == null) ? "" : v.trim().toUpperCase(Locale.ROOT);
        if (x.isBlank()) return "";
        if (!ATTEND_KHORS_VALUES.contains(x)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ATTEND_KHORS", "Invalid attendKhors value");
        }
        return x;
    }


    public User register(RegisterRequest request) {
        if (request.getPassword() == null || !request.getPassword().equals(request.getConfirmPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_MISMATCH", "Passwords do not match");
        }

        userRepository.findByUsername(request.getUsername())
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "Username already in use");
                });

        String email = request.getEmail() == null ? "" : request.getEmail().trim().toLowerCase();

        userRepository.findByEmail(email).ifPresent(u -> {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "EMAIL_TAKEN",
                    "Email already in use",
                    java.util.Map.of("email", "الإيميل مسجل بالفعل")
            );
        });

        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNationalId(request.getNationalId());
        FamilyCatalog memberFamily = familyCatalogService.resolveMemberFamily(request.getDeaconFamilyId(), request.getDeaconFamily());
        user.setDeaconDegree(request.getDeaconDegree());

        String requestedKhors = normalizeKhors(request.getKhors(), false);
        user.setKhors("NONE");
        user.setAttendKhors("NONE");
        user.setServingScope(null);
        user.setPhoneNumber(request.getPhoneNumber());
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

        String nid = request.getNationalId() == null ? "" : request.getNationalId().trim();
        userRepository.findByNationalId(nid).ifPresent(existing -> {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "NATIONAL_ID_TAKEN",
                    "National ID already in use",
                    java.util.Map.of("nationalId", "الرقم القومي مسجل بالفعل")
            );
        });

        userRepository.save(user);

        if (familyJoinRequestService.canJoinDirectly(user, memberFamily)) {
            userFamilyRoleService.replaceAssignments(user, List.of(
                    UserFamilyAssignmentView.builder()
                            .familyId(memberFamily.getId())
                            .familyName(memberFamily.getNameAr())
                            .roleCode(com.shmamsa.model.FamilyRoleCode.MAKHDOM.getCode())
                            .role(com.shmamsa.model.FamilyRoleCode.MAKHDOM.getRoleName())
                            .assignmentOrder(1)
                            .build()
            ));
        } else {
            familyJoinRequestService.createRequest(user, memberFamily.getId());
        }

        userRepository.save(user);
        attendanceBackfillService.backfillForUser(user);

        khorsJoinRequestService.createForUserIfNeeded(user, requestedKhors);
        return user;
    }


    public User registerServant(RegisterServantRequest request) {
        if (!servantSecretService.validateSecret(request.getSecret())) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN,
                    "INVALID_SECRET",
                    "Invalid registration secret",
                    java.util.Map.of("secret", "كود التأكيد غير صحيح")
            );
        }


        if (request.getPassword() == null || !request.getPassword().equals(request.getConfirmPassword())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PASSWORD_MISMATCH", "Passwords do not match");
        }

        userRepository.findByUsername(request.getUsername())
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "USERNAME_TAKEN", "Username already in use");
                });

        String nid = request.getNationalId().trim();
        userRepository.findByNationalId(nid).ifPresent(existing -> {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "NATIONAL_ID_TAKEN",
                    "National ID already in use",
                    java.util.Map.of("nationalId", "الرقم القومي مسجل بالفعل")
            );
        });

        String scope = normalizeServingScope(request.getServingScope());
        if (!( "FAMILY_ONLY".equals(scope) || "KHORS_ONLY".equals(scope) || "BOTH".equals(scope) )) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_SCOPE", "Invalid serving scope");
        }

        String email = request.getEmail() == null ? "" : request.getEmail().trim().toLowerCase();

        userRepository.findByEmail(email).ifPresent(u -> {
            throw new ApiException(
                    HttpStatus.CONFLICT,
                    "EMAIL_TAKEN",
                    "Email already in use",
                    java.util.Map.of("email", "الإيميل مسجل بالفعل")
            );
        });
        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail(email);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setNationalId(nid);
        FamilyCatalog primaryFamily = null;
        FamilyCatalog secondaryFamily = null;

        if ("KHORS_ONLY".equals(scope)) {
            String kTmp = normalizeKhors(request.getKhors(), true);
            if ("NONE".equals(kTmp) || kTmp.isBlank()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "KHORS_REQUIRED", "Khors is required for this scope");
            }
            primaryFamily = familyCatalogService.resolveServantFamily(request.getDeaconFamilyId(), request.getDeaconFamily());
        } else {
            primaryFamily = familyCatalogService.resolveServantFamily(request.getDeaconFamilyId(), request.getDeaconFamily());

            if (request.getDeaconFamily2Id() != null || (request.getDeaconFamily2() != null && !request.getDeaconFamily2().trim().isBlank())) {
                FamilyCatalog extraFamily = familyCatalogService.resolveServantFamily(request.getDeaconFamily2Id(), request.getDeaconFamily2());
                if (!extraFamily.getId().equals(primaryFamily.getId())) {
                    secondaryFamily = extraFamily;
                }
            }
        }

        user.setDeaconDegree(request.getDeaconDegree());
        user.setRole("KHADIM");

        user.setServingScope(scope);

        if ("FAMILY_ONLY".equals(scope)) {
            user.setKhors("NONE");
        } else {
            String k = normalizeKhors(request.getKhors(), true);
            if ("NONE".equals(k)) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "KHORS_REQUIRED", "Khors is required for this scope");
            }
            user.setKhors(k);
        }

        String requestedAttendKhors = "NONE";

        if ("FAMILY_ONLY".equals(scope)) {
            String attend = normalizeAttendKhors(request.getAttendKhors());
            if (attend.isBlank()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "ATTEND_KHORS_REQUIRED", "حضور الخورس مطلوب");
            }

            requestedAttendKhors = attend;
            user.setAttendKhors("NONE"); // pending until approved
        } else {

            if ("MARMARKOS".equalsIgnoreCase(user.getKhors())) {
                user.setAttendKhors("ATHANASIUS");
            } else {
                user.setAttendKhors("NONE");
            }
        }


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
        List<UserFamilyAssignmentView> assignments = new ArrayList<>();
        if (primaryFamily != null) {
            assignments.add(UserFamilyAssignmentView.builder()
                    .familyId(primaryFamily.getId())
                    .familyName(primaryFamily.getNameAr())
                    .roleCode(com.shmamsa.model.FamilyRoleCode.KHADIM.getCode())
                    .role(com.shmamsa.model.FamilyRoleCode.KHADIM.getRoleName())
                    .assignmentOrder(1)
                    .build());
        }
        if (secondaryFamily != null) {
            assignments.add(UserFamilyAssignmentView.builder()
                    .familyId(secondaryFamily.getId())
                    .familyName(secondaryFamily.getNameAr())
                    .roleCode(com.shmamsa.model.FamilyRoleCode.KHADIM.getCode())
                    .role(com.shmamsa.model.FamilyRoleCode.KHADIM.getRoleName())
                    .assignmentOrder(2)
                    .build());
        }
        userFamilyRoleService.replaceAssignments(user, assignments);
        userRepository.save(user);
        attendanceBackfillService.backfillForUser(user);

        khorsJoinRequestService.createForUserIfNeeded(user, requestedAttendKhors);
        return user;

    }



    public String login(String username, String password) {
        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "اسم المستخدم أو كلمة المرور غير صحيحة"));

        if (!passwordEncoder.matches(password, user.getPassword())) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "اسم المستخدم أو كلمة المرور غير صحيحة");
        }

        return jwtUtils.generateToken(user.getUsername(), user.getRole());
    }


    public User getUserFromToken(String token) {
        String username = jwtUtils.extractUsername(token);
        return userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "المستخدم غير موجود", "المستخدم غير موجود"));
    }


    public Map<String, Object> generateResetTokenByEmail(String email) {
        if (email == null || email.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "الايميل مطلوب ", "الايميل مطلوب");
        }

        User user = userRepository.findByEmail(email.trim()).orElse(null);

        if (user != null) {
            sendOtpForUserByEmail(user);
        }

        return Map.of("message", "إذا كان البريد الإلكتروني مسجلًا فسيتم إرسال رمز التحقق");
    }


    private void sendOtpForUserByEmail(User user) {
        String username = user.getUsername();
        long now = System.currentTimeMillis();

        if (otpTimestamps.containsKey(username)) {
            long lastSent = otpTimestamps.get(username);
            if (now - lastSent < COOLDOWN_MS) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "OTP_COOLDOWN", "انتظر 45 ثانية قبل طلب رمز آخر.");
            }
        }

        RateWindow window = hourlyRequests.compute(username, (key, current) -> {
            if (current == null || now - current.windowStartMs >= 3600_000) {
                return new RateWindow(0, now);
            }
            return current;
        });

        synchronized (window) {
            if (window.count >= HOURLY_LIMIT) {
                throw new ApiException(HttpStatus.TOO_MANY_REQUESTS, "OTP_LIMIT", "طلبات رمز التحقق كثيرة جدًا. حاول مرة أخرى بعد ساعة.");
            }
            window.count += 1;
        }

        String code = String.format("%05d", ThreadLocalRandom.current().nextInt(100000));

        otpStore.put(code, new OtpData(username, now + OTP_TTL_MS));

        otpTimestamps.put(username, now);

        emailService.sendOtpEmail(user.getEmail(), user.getFullName(), user.getUsername(), code);
    }


    public void resetPassword(String otp, String newPassword) {
        if (otp == null || otp.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "يلزم رمز التحقق", "يلزم رمز التحقق");
        if (newPassword == null || newPassword.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "يلزم كلمة المرور", "يلزم كلمة المرور الجديدة ");

        OtpData data = otpStore.get(otp);
        if (data == null) throw new ApiException(HttpStatus.BAD_REQUEST, "رمز التحق خطأ", "رمز التحقق خطأ او منتهش الصلاحية");

        if (System.currentTimeMillis() > data.expiresAt) {
            otpStore.remove(otp);
            throw new ApiException(HttpStatus.BAD_REQUEST, "تم انتهاء مدء رمز التحقق", "تم انتهاء مدء رمز التحقق");
        }

        String username = data.username;

        User user = userRepository.findByUsername(username)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "المستخدم غير موجود", "المستخدم غير موجود"));

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
