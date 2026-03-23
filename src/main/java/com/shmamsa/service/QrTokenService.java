package com.shmamsa.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;

@Service
@RequiredArgsConstructor
public class QrTokenService {

    private final ObjectMapper mapper;

    @Value("${qr.secret:${jwt.secret}}")
    private String secret;

    @Value("${qr.expiration-seconds:86400}")
    private long expirationSeconds;

    public String issueToken(Long userId) {
        try {
            Map<String, Object> payload = Map.of(
                    "v", 1,
                    "id", userId,
                    "iat", Instant.now().getEpochSecond(),
                    "exp", Instant.now().plusSeconds(Math.max(expirationSeconds, 60)).getEpochSecond()
            );
            String json = mapper.writeValueAsString(payload);
            String payloadB64 = b64UrlEncode(json.getBytes(StandardCharsets.UTF_8));

            byte[] sig = hmacSha256(payloadB64.getBytes(StandardCharsets.UTF_8), secret.getBytes(StandardCharsets.UTF_8));
            String sigB64 = b64UrlEncode(sig);

            return payloadB64 + "." + sigB64;
        } catch (Exception e) {
            throw new RuntimeException("Failed to issue QR token", e);
        }
    }

    public Long verifyAndExtractUserId(String token) {
        if (token == null) return null;
        String t = token.trim();
        String[] parts = t.split("\\.");
        if (parts.length != 2) return null;

        String payloadB64 = parts[0];
        String sigB64 = parts[1];

        try {
            byte[] expectedSig = hmacSha256(payloadB64.getBytes(StandardCharsets.UTF_8), secret.getBytes(StandardCharsets.UTF_8));
            byte[] providedSig = b64UrlDecode(sigB64);

            if (!MessageDigest.isEqual(expectedSig, providedSig)) return null;

            byte[] payloadJson = b64UrlDecode(payloadB64);
            @SuppressWarnings("unchecked")
            Map<String, Object> payload = mapper.readValue(payloadJson, Map.class);

            Object idObj = payload.get("id");
            Object expObj = payload.get("exp");
            if (idObj == null) return null;
            if (expObj == null) return null;

            long exp;
            if (expObj instanceof Number n) exp = n.longValue();
            else exp = Long.parseLong(String.valueOf(expObj));
            if (Instant.now().getEpochSecond() > exp) return null;

            if (idObj instanceof Number n) return n.longValue();
            return Long.valueOf(String.valueOf(idObj));
        } catch (Exception e) {
            return null;
        }
    }

    private static byte[] hmacSha256(byte[] data, byte[] key) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(key, "HmacSHA256"));
        return mac.doFinal(data);
    }

    private static String b64UrlEncode(byte[] bytes) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static byte[] b64UrlDecode(String s) {
        return Base64.getUrlDecoder().decode(s);
    }
}
