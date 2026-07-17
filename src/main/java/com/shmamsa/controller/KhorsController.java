package com.shmamsa.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.ChoirStanding;
import com.shmamsa.model.User;
import com.shmamsa.repository.ChoirStandingRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.FamilyAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.*;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/khors")
@RequiredArgsConstructor
public class KhorsController {

    private final UserRepository userRepo;
    private final FamilyAccessService familyAccessService;
    private final ChoirStandingRepository choirStandingRepo;
    private final ObjectMapper objectMapper;

    private static String normRole(String raw) {
        if (raw == null) return "";
        String r = raw.trim();
        r = r.replace("ROLE_", "");
        return r.trim().toUpperCase();
    }

    private User me(Authentication auth) {
        if (auth == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    private static String normKhors(String k) {
        if (k == null) return null;
        String x = k.trim().toUpperCase();
        if (x.equals("خورس مارمرقس")) return "MARMARKOS";
        if (x.equals("خورس البابا اثناسيوس")) return "ATHANASIUS";
        return x;
    }

    private void ensureCanManage(User actor) {
        String role = normRole(actor.getRole());
        boolean ok = "AMIN_KHEDMA".equals(role) || "DEVELOPER".equals(role);
        if (!ok) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
    }

    @GetMapping("/members")
    public ResponseEntity<?> members(@RequestParam String khors, Authentication auth) {
        User actor = me(auth);
        ensureCanManage(actor);

        String code = normKhors(khors);
        if (code == null || code.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "khors is required");

        List<String> rolesToShow = List.of("MAKHDOM", "KHADIM", "AMIN_OSRA", "AMIN_KHEDMA");

        List<User> a = userRepo.findByKhorsAndRoleIn(code, rolesToShow);
        List<User> b = userRepo.findByAttendKhorsAndRoleIn(code, rolesToShow);

        // Merge unique by id
        Map<Long, User> map = new LinkedHashMap<>();
        for (User u : a) map.put(u.getId(), u);
        for (User u : b) map.put(u.getId(), u);

        // Sort by role level then name
        List<User> out = new ArrayList<>(map.values());
        out.sort(Comparator
                .comparing((User u) -> normRole(u.getRole()))
                .thenComparing(u -> Optional.ofNullable(u.getFullName()).orElse("")));

        // minimal view (avoid password)
        List<Map<String, Object>> view = out.stream().map(u -> {
            Map<String, Object> m = new LinkedHashMap<>();
            m.put("id", u.getId());
            m.put("fullName", u.getFullName());
            m.put("role", normRole(u.getRole()));
            m.put("deaconFamily", familyAccessService.primaryFamilyName(u));
            m.put("deaconFamily2", familyAccessService.secondaryFamilyName(u));
            m.put("deaconFamily3", familyAccessService.thirdFamilyName(u));
            m.put("deaconFamily4", familyAccessService.fourthFamilyName(u));
            m.put("khors", u.getKhors());
            m.put("khorsYear", u.getKhorsYear());
            m.put("attendKhors", u.getAttendKhors());
            return m;
        }).collect(Collectors.toList());

        return ResponseEntity.ok(view);
    }

    @DeleteMapping("/members/{id}")
    public ResponseEntity<?> remove(@PathVariable Long id, @RequestParam String khors, Authentication auth) {
        User actor = me(auth);
        ensureCanManage(actor);

        String code = normKhors(khors);
        if (code == null || code.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "khors is required");

        User target = userRepo.findById(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Not found"));

        boolean changed = false;

        if (target.getKhors() != null && target.getKhors().trim().equalsIgnoreCase(code)) {
            target.setKhors(null);
            target.setKhorsYear(null);
            changed = true;
        }
        if (target.getAttendKhors() != null && target.getAttendKhors().trim().equalsIgnoreCase(code)) {
            target.setAttendKhors("NONE");
            changed = true;
        }

        if (changed) userRepo.save(target);

        return ResponseEntity.ok(Map.of("removed", changed));
    }

    // ===== Choir Standing =====

    /** GET /api/khors/standing?khors= — any authenticated user */
    @GetMapping("/standing")
    public ResponseEntity<?> getStanding(@RequestParam String khors, Authentication auth) {
        me(auth);
        String code = normKhors(khors);
        if (code == null || code.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "khors required");

        Optional<ChoirStanding> opt = choirStandingRepo.findByKhors(code);
        if (opt.isEmpty()) return ResponseEntity.ok(null);

        ChoirStanding s = opt.get();
        return ResponseEntity.ok(toStandingView(s));
    }

    /** PUT /api/khors/standing — AMIN_KHEDMA / DEVELOPER only (covered by security config) */
    @PutMapping("/standing")
    public ResponseEntity<?> saveStanding(@RequestBody Map<String, Object> body, Authentication auth) {
        User actor = me(auth);
        ensureCanManage(actor);

        String khors = normKhors((String) body.get("khors"));
        if (khors == null || khors.isBlank()) throw new ApiException(HttpStatus.BAD_REQUEST, "khors required");

        ChoirStanding s = choirStandingRepo.findByKhors(khors).orElse(new ChoirStanding());
        s.setKhors(khors);
        s.setRows(toInt(body.get("rows"), 4));
        s.setCols(toInt(body.get("cols"), 6));
        s.setDirection(body.get("direction") != null ? body.get("direction").toString() : "right");
        s.setPublished(Boolean.TRUE.equals(body.get("published")));
        s.setFrontAtTop(!Boolean.FALSE.equals(body.get("frontAtTop")));
        s.setFrontOffset(toInt(body.get("frontOffset"), 0));
        s.setCrowdOffset(toInt(body.get("crowdOffset"), 0));

        try {
            Object seats = body.get("seats");
            s.setSeatsJson(seats != null ? objectMapper.writeValueAsString(seats) : "[]");
        } catch (Exception e) {
            s.setSeatsJson("[]");
        }

        choirStandingRepo.save(s);
        return ResponseEntity.ok(toStandingView(s));
    }

    @SuppressWarnings("unchecked")
    private Map<String, Object> toStandingView(ChoirStanding s) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("khors", s.getKhors());
        m.put("rows", s.getRows());
        m.put("cols", s.getCols());
        m.put("direction", s.getDirection());
        m.put("published", s.isPublished());
        m.put("frontAtTop", s.isFrontAtTop());
        m.put("frontOffset", s.getFrontOffset());
        m.put("crowdOffset", s.getCrowdOffset());
        m.put("updatedAt", s.getUpdatedAt() != null ? s.getUpdatedAt().toString() : null);
        try {
            m.put("seats", objectMapper.readValue(
                s.getSeatsJson() != null ? s.getSeatsJson() : "[]", List.class));
        } catch (Exception e) {
            m.put("seats", List.of());
        }
        return m;
    }

    private static int toInt(Object v, int def) {
        if (v == null) return def;
        if (v instanceof Number) return ((Number) v).intValue();
        try { return Integer.parseInt(v.toString()); } catch (Exception e) { return def; }
    }
}
