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

    @Value("${spring.mail.username}")
    private String fromEmail;

    public void sendOtpEmail(String toEmail, String fullName, String username, String otpCode) {
        try {
            MimeMessage message = mailSender.createMimeMessage();

            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom(fromEmail);
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
    public void sendServantSecretEmail(String toEmail, String secret, String validToText) {
        try {
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, true, "UTF-8");

            helper.setFrom(fromEmail);
            helper.setTo(toEmail);
            helper.setSubject("Servant Registration Secret (24h)");

            String body =
                    "🛡️ Servant registration secret:\n\n" +
                            secret + "\n\n" +
                            "Valid until: " + validToText + "\n\n" +
                            "St. Mary Church – Omrania ❤";

            helper.setText(body, false);
            mailSender.send(message);

        } catch (Exception e) {
            throw new RuntimeException("Failed to send servant secret email: " + e.getMessage(), e);
        }
    }

}
