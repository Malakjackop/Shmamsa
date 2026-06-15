package com.shmamsa.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.shmamsa.service.AuthService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@Slf4j
@RestController
@RequestMapping("/api/whatsapp")
@RequiredArgsConstructor
public class WhatsAppWebhookController {

    private final AuthService authService;

    @Value("${whatsapp.webhook-verify-token}")
    private String verifyToken;

    @GetMapping("/webhook")
    public ResponseEntity<String> verify(
            @RequestParam("hub.mode") String mode,
            @RequestParam("hub.verify_token") String token,
            @RequestParam("hub.challenge") String challenge) {

        if ("subscribe".equals(mode) && verifyToken.equals(token)) {
            log.info("[WhatsApp] Webhook verified");
            return ResponseEntity.ok(challenge);
        }
        return ResponseEntity.status(403).body("Forbidden");
    }

    @PostMapping("/webhook")
    public ResponseEntity<String> receive(@RequestBody JsonNode payload) {
        try {
            JsonNode entry = payload.path("entry");
            if (!entry.isArray() || entry.isEmpty()) return ResponseEntity.ok("EVENT_RECEIVED");

            JsonNode changes = entry.get(0).path("changes");
            if (!changes.isArray() || changes.isEmpty()) return ResponseEntity.ok("EVENT_RECEIVED");

            JsonNode value = changes.get(0).path("value");
            JsonNode messages = value.path("messages");

            if (!messages.isArray() || messages.isEmpty()) return ResponseEntity.ok("EVENT_RECEIVED");

            JsonNode msg = messages.get(0);
            String from = msg.path("from").asText();
            String type = msg.path("type").asText();

            if (!"text".equals(type)) return ResponseEntity.ok("EVENT_RECEIVED");

            String text = msg.path("text").path("body").asText().trim().toUpperCase();

            // الـ waCode هو 5 حروف/أرقام
            if (text.length() == 5) {
                log.info("[WhatsApp] waCode received from: {}", from);
                authService.sendOtpByPhone(from, text);
            }

        } catch (Exception e) {
            log.error("[WhatsApp] Webhook error: {}", e.getMessage());
        }

        return ResponseEntity.ok("EVENT_RECEIVED");
    }
}
