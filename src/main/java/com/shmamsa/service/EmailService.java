package com.shmamsa.service;

import jakarta.mail.internet.MimeMessage;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class EmailService {

    private final JavaMailSender mailSender;

    // ✅ read from application.properties
    @Value("${spring.mail.username}")
    private String fromEmail;

    public void sendOtpEmail(String toEmail, String fullName, String username, String otpCode) {
        try {
            MimeMessage message = mailSender.createMimeMessage();

            // true = multipart, "UTF-8" = supports emojis
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom(fromEmail);     // ✅ THIS FIXES THE ERROR
            helper.setTo(toEmail);
            helper.setSubject("Password Reset Code");

            String body =
                    "👋 Hello " + fullName + "!\n\n" +
                            "Your account (" + username + ") password reset code is: " + otpCode + "\n" +
                            "It’s valid for 5 minutes.\n\n" +
                            "Sent from St. Mary Church – Omrania ❤";

            helper.setText(body, false);

            mailSender.send(message);

        } catch (Exception e) {
            throw new RuntimeException("Failed messages: " + e.getMessage(), e);
        }
    }
}
