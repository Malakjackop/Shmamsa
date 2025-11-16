package com.shmamsa.service;

import com.shmamsa.model.User;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Service
public class WhatsAppService {

    @Value("${node.whatsapp.url:http://localhost:3000}")
    private String nodeUrl;

    @Value("${node.secret.key}")
    private String secretKey;

    private final RestTemplate rest = new RestTemplate();


    // ----- SEND OTP -----
    public void sendResetCode(User user, String code) {

        String phone = user.getPhoneNumber() != null ?
                user.getPhoneNumber() :
                user.getGuardiansPhone();

        if (phone == null || phone.isEmpty()) return;

        String msg =
                "👋 Hello " + user.getFullName() + " !\n\n" +
                        "Your account (" + user.getUsername() + ") password reset code is: *" + code + "*\n" +
                        "It’s valid for 5 minutes.\n\n" +
                        "Sent from St. Mary Church – Omrania ❤";

        sendMessage(phone, msg);
    }


    // ----- SEND SUCCESS MESSAGE -----
    public void sendPasswordChangedMessage(User user) {

        String phone = user.getPhoneNumber() != null ?
                user.getPhoneNumber() :
                user.getGuardiansPhone();

        String msg =
                "✅ Hi " + user.getFullName() + ",\n\n" +
                        "Your password has been changed successfully.\n" +
                        "If this wasn’t you, please contact support immediately.";

        sendMessage(phone, msg);
    }


    // ----- SEND WHATSAPP MESSAGE USING NODE JS -----
    private void sendMessage(String phone, String msg) {
        try {
            HttpHeaders headers = new HttpHeaders();
            headers.setContentType(MediaType.APPLICATION_JSON);
            headers.add("x-api-key", secretKey);

            Map<String, String> body = Map.of(
                    "phone", phone,
                    "message", msg
            );

            rest.postForEntity(
                    nodeUrl + "/send-message",
                    new HttpEntity<>(body, headers),
                    String.class
            );

        } catch (Exception e) {
            System.out.println("❌ WhatsApp send error: " + e.getMessage());
        }
    }
}
