package com.shmamsa.service;

import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.util.List;

@Slf4j
@Component
@RequiredArgsConstructor
public class BirthdayWishScheduler {

    private final UserRepository userRepository;
    private final WhatsAppService whatsAppService;

    // كل يوم الساعة 9 الصبح
//    @Scheduled(cron = "0 0 9 * * *")
    public void sendBirthdayWishes() {
        LocalDate today = LocalDate.now();
        int month = today.getMonthValue();
        int day = today.getDayOfMonth();

        // جيب كل المستخدمين اللي عيد ميلادهم النهارده
        List<User> allUsers = userRepository.findAll();

        int sent = 0;
        for (User user : allUsers) {
            if (user.getDateOfBirth() == null) continue;
            if (user.getPhoneNumber() == null || user.getPhoneNumber().isBlank()) continue;

            LocalDate dob = user.getDateOfBirth();
            if (dob.getMonthValue() != month || dob.getDayOfMonth() != day) continue;

            // حوّل الرقم المصري (011XXXXXXXX) لصيغة دولية (20XXXXXXXXX)
            String phone = toInternational(user.getPhoneNumber());
            if (phone == null) continue;

            whatsAppService.sendBirthdayWish(phone, user.getFullName());
            sent++;
            log.info("[Birthday] Sent wish to {} ({})", user.getFullName(), phone);
        }

        log.info("[Birthday] Done. Sent {} wishes for {}/{}", sent, day, month);
    }

    // حوّل 01XXXXXXXXX → 2001XXXXXXXXX
    private String toInternational(String phone) {
        if (phone == null) return null;
        phone = phone.trim();
        if (phone.startsWith("0") && phone.length() == 11) {
            return "20" + phone.substring(1);
        }
        if (phone.startsWith("20") && phone.length() == 12) {
            return phone;
        }
        return null; // رقم غير صالح
    }
}
