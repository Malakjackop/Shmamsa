package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import lombok.RequiredArgsConstructor;
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
        if (x.equals("خورس الانبا اثناسيوس")) return "ATHANASIUS";
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
            m.put("deaconFamily", u.getDeaconFamily());
            m.put("deaconFamily2", u.getDeaconFamily2());
            m.put("deaconFamily3", u.getDeaconFamily3());
            m.put("deaconFamily4", u.getDeaconFamily4());
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
}
