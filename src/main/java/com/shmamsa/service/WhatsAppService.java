package com.shmamsa.service;

import com.shmamsa.model.User;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.*;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestTemplate;

import java.util.Map;

@Service
public class WhatsAppService {

    @Value("${whatsapp.api.url:https://graph.facebook.com/v19.0/PLACEHOLDER/messages}")
    private String apiUrl;

    @Value("${whatsapp.token:PLACEHOLDER}")
    private String token;

    // ✅ Use your WhatsApp business number here
    private static final String SENDER_PHONE = "01033646696"; // your sender number

    // ✅ Simulation mode (set to false if you have real API access)
    private static final boolean SIMULATION_MODE = true;

    /**
     * Send WhatsApp reset code message
     *
     * @param user       The user to send the message to
     * @param tokenCode  The 5-digit reset code
     */
    public void sendResetCode(User user, String tokenCode) {
        String phoneNumber = user.getPhoneNumber() != null && !user.getPhoneNumber().isEmpty()
                ? user.getPhoneNumber()
                : user.getGuardiansPhone();

        if (phoneNumber == null || phoneNumber.isEmpty()) {
            System.out.println("⚠️ No valid phone number found for user: " + user.getUsername());
            return;
        }

        // ✅ The message content with name and code
        String message = String.format(
                "👋 Hello %s!\n\nYour Deacons Family password reset code is: *%s*\n\n" +
                        "Sent from St. Mary Church – Omrania ❤️\n(WhatsApp Service: %s)",
                user.getFullName(), tokenCode, SENDER_PHONE
        );

        if (SIMULATION_MODE) {
            System.out.println("📱 Simulating WhatsApp send:");
            System.out.println("To: " + phoneNumber);
            System.out.println("Message:\n" + message);
            return;
        }

        // ✅ Real API mode
        RestTemplate restTemplate = new RestTemplate();

        Map<String, Object> body = Map.of(
                "messaging_product", "whatsapp",
                "to", phoneNumber,
                "type", "text",
                "text", Map.of("preview_url", false, "body", message)
        );

        HttpHeaders headers = new HttpHeaders();
        headers.setContentType(MediaType.APPLICATION_JSON);
        headers.setBearerAuth(token);

        HttpEntity<Map<String, Object>> entity = new HttpEntity<>(body, headers);

        try {
            ResponseEntity<String> response = restTemplate.postForEntity(apiUrl, entity, String.class);
            System.out.println("✅ WhatsApp API Response: " + response.getBody());
        } catch (Exception e) {
            System.err.println("❌ Failed to send WhatsApp message: " + e.getMessage());
        }
    }
}
