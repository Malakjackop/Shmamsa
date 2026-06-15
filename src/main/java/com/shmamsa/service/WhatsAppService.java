package com.shmamsa.service;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Slf4j
@Service
@RequiredArgsConstructor
public class WhatsAppService {

    @Value("${whatsapp.phone-number-id}")
    private String phoneNumberId;

    @Value("${whatsapp.access-token}")
    private String accessToken;

    private final RestTemplate restTemplate;

    public void sendOtp(String toPhone, String otp) {
        String message = "🔐 كود التحقق بتاعك في أسرة الشمامسة هو: *" + otp + "*\n\nصالح لمدة 5 دقائق فقط.";
        sendTextMessage(toPhone, message);
    }

    public void sendBirthdayWish(String toPhone, String fullName) {
        String url = "https://graph.facebook.com/v21.0/" + phoneNumberId + "/messages";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);

        Map<String, Object> body = Map.of(
            "messaging_product", "whatsapp",
            "to", toPhone,
            "type", "template",
            "template", Map.of(
                "name", "birthday_wishs",
                "language", Map.of("code", "ar"),
                "components", java.util.List.of(
                    Map.of(
                        "type", "body",
                        "parameters", java.util.List.of(
                            Map.of("type", "text", "text", fullName)
                        )
                    )
                )
            )
        );

        send(url, headers, body, "Birthday wish to " + toPhone);
    }

    // ─── Helper: بيبعت رسالة نصية عادية ───
    private void sendTextMessage(String toPhone, String message) {
        String url = "https://graph.facebook.com/v21.0/" + phoneNumberId + "/messages";

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(accessToken);

        Map<String, Object> body = Map.of(
            "messaging_product", "whatsapp",
            "to", toPhone,
            "type", "text",
            "text", Map.of("body", message)
        );

        send(url, headers, body, "Text message to " + toPhone);
    }

    private void send(String url, HttpHeaders headers, Map<String, Object> body, String logLabel) {
        try {
            HttpEntity<Map<String, Object>> request = new HttpEntity<>(body, headers);
            restTemplate.postForEntity(url, request, String.class);
            log.info("[WhatsApp] Sent: {}", logLabel);
        } catch (Exception e) {
            log.error("[WhatsApp] Failed to send {}: {}", logLabel, e.getMessage());
        }
    }
}
