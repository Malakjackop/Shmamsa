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
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import java.time.YearMonth;
import java.time.LocalDate;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ThreadLocalRandom;

@Slf4j
@Service
@RequiredArgsConstructor
public class AuthService {

    private final UserRepository userRepository;
    private final BCryptPasswordEncoder passwordEncoder;
    private final JwtUtils jwtUtils;
    private final EmailService emailService;
    private final WhatsAppService whatsAppService;

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

    private static class WaCodeData {
        String phoneNumber;
        long expiresAt;

        WaCodeData(String phoneNumber, long expiresAt) {
            this.phoneNumber = phoneNumber;
            this.expiresAt = expiresAt;
        }
    }

    private final Map<String, OtpData> otpStore = new ConcurrentHashMap<>();
    private final Map<String, Long> otpTimestamps = new ConcurrentHashMap<>();
    private final Map<String, RateWindow> hourlyRequests = new ConcurrentHashMap<>();
    private final Map<String, WaCodeData> waCodeStore = new ConcurrentHashMap<>();
    private final Map<String, String> monthlyResetTracker = new ConcurrentHashMap<>();

    private static final long OTP_TTL_MS = 5 * 60 * 1000;
    private static final long WA_CODE_TTL_MS = 10 * 60 * 1000;
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


        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail("");
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

        user.setYearsInFamily(request.getYearsInFamily());

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


        User user = new User();
        user.setFullName(request.getFullName());
        user.setUsername(request.getUsername());
        user.setEmail("");
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
            user.setAttendKhors("NONE");
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

        user.setYearsInFamily(request.getYearsInFamily());

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

    // ─── WaCode: بيتبعت للـ frontend عشان المستخدم يبعته على الواتساب ───
    public Map<String, Object> generateWaCodeByPhone(String phoneNumber) {
        if (phoneNumber == null || phoneNumber.isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "PHONE_REQUIRED", "رقم الهاتف مطلوب");
        }

        User user = userRepository.findByPhoneNumber(phoneNumber.trim()).orElse(null);
        if (user == null) {
            return Map.of("message", "إذا كان الرقم مسجلاً سيتم إرسال الكود");
        }

        // Monthly limit: مرة واحدة في الشهر
        String currentMonth = YearMonth.now().toString();
        String lastMonth = monthlyResetTracker.get(user.getUsername());
        if (currentMonth.equals(lastMonth)) {
            throw new ApiException(
                    HttpStatus.TOO_MANY_REQUESTS,
                    "MONTHLY_LIMIT",
                    "لقد استخدمت طلب استعادة كلمة المرور هذا الشهر. حاول مرة أخرى الشهر القادم."
            );
        }

        String waCode = generateRandomCode();
        waCodeStore.put(waCode, new WaCodeData(phoneNumber.trim(), System.currentTimeMillis() + WA_CODE_TTL_MS));
        monthlyResetTracker.put(user.getUsername(), currentMonth);

        return Map.of(
                "waCode", waCode,
                "message", "افتح واتساب وأرسل الكود"
        );
    }

    private String generateRandomCode() {
        String chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        StringBuilder code = new StringBuilder();
        for (int i = 0; i < 5; i++) {
            code.append(chars.charAt(ThreadLocalRandom.current().nextInt(chars.length())));
        }
        return code.toString();
    }

    public void sendOtpByPhone(String whatsappPhone, String waCode) {
        log.info("[WhatsApp] Looking for waCode: '{}', store size: {}", waCode, waCodeStore.size());

        WaCodeData codeData = waCodeStore.get(waCode.trim().toUpperCase());
        log.info("[WhatsApp] codeData found: {}", codeData != null);

        if (codeData == null || System.currentTimeMillis() > codeData.expiresAt) {
            waCodeStore.remove(waCode);
            return;
        }

        String localPhone = toLocalPhone(whatsappPhone);
        if (!codeData.phoneNumber.equals(localPhone)) {
            return;
        }

        waCodeStore.remove(waCode);

        User user = userRepository.findByPhoneNumber(localPhone).orElse(null);
        if (user == null) return;

        String username = user.getUsername();
        long now = System.currentTimeMillis();

        if (otpTimestamps.containsKey(username)) {
            if (now - otpTimestamps.get(username) < COOLDOWN_MS) return;
        }

        String code = String.format("%05d", ThreadLocalRandom.current().nextInt(100000));
        otpStore.put(code, new OtpData(username, now + OTP_TTL_MS));
        otpTimestamps.put(username, now);

        whatsAppService.sendOtp(whatsappPhone, code);
    }

    private String toLocalPhone(String whatsappPhone) {
        if (whatsappPhone == null) return null;
        if (whatsappPhone.startsWith("20") && whatsappPhone.length() == 12) {
            return "0" + whatsappPhone.substring(2);
        }
        return whatsappPhone;
    }

    public void resetPassword(String otp, String newPassword) {
        if (otp == null || otp.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "يلزم رمز التحقق", "يلزم رمز التحقق");
        if (newPassword == null || newPassword.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "يلزم كلمة المرور", "يلزم كلمة المرور الجديدة");

        OtpData data = otpStore.get(otp);
        if (data == null) throw new ApiException(HttpStatus.BAD_REQUEST, "رمز التحقق خطأ", "رمز التحقق خطأ او منتهي الصلاحية");

        if (System.currentTimeMillis() > data.expiresAt) {
            otpStore.remove(otp);
            throw new ApiException(HttpStatus.BAD_REQUEST, "تم انتهاء مدة رمز التحقق", "تم انتهاء مدة رمز التحقق");
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
        waCodeStore.entrySet().removeIf(e -> e.getValue() == null || e.getValue().expiresAt < now);
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
