package com.shmamsa.controller;

import com.shmamsa.dto.IftekadVisitCreateRequest;
import com.shmamsa.dto.IftekadVisitUpdateRequest;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.IftekadVisit;
import com.shmamsa.model.User;
import com.shmamsa.repository.IftekadVisitRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.FamilyAccessService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.*;

@RestController
@RequestMapping("/api/iftekad")
@RequiredArgsConstructor
public class IftekadController {

    private final IftekadVisitRepository iftekadRepo;
    private final UserRepository userRepo;
    private final FamilyAccessService familyAccessService;

    private static String normRole(String raw) {
        if (raw == null) return "";
        String r = raw.trim();
        r = r.replace("ROLE_", "");
        String upper = r.toUpperCase().replaceAll("[-\\s]+", "_");

        String ar = r.replaceAll("[\\u064B-\\u065F\\u0670\\u0640]", "")
                .trim()
                .replaceAll("\\s+", " ");

        if (ar.equals("خادم")) return "KHADIM";
        if (ar.equals("امين اسرة") || ar.equals("أمين أسرة") || ar.equals("امين الاسرة") || ar.equals("أمين الاسره") || ar.equals("امين الأسرة")) return "AMIN_OSRA";
        if (ar.equals("امين خدمة") || ar.equals("أمين خدمة") || ar.equals("امين الخدمه") || ar.equals("أمين الخدمه")) return "AMIN_KHEDMA";
        return upper;
    }

    private List<String> servingBasesOf(User u) {
        return familyAccessService.servingBasesOf(u);
    }

    private List<String> memberBasesOf(User user) {
        if (user == null) return List.of();
        List<String> bases = new ArrayList<>();
        var assignments = user.getFamilyAssignments();
        if (assignments == null || assignments.isEmpty()) {
            String fallback = familyAccessService.baseFamily(user);
            return (fallback == null || fallback.isBlank()) ? List.of() : List.of(fallback);
        }
        for (var assignment : assignments) {
            String candidate = familyAccessService.baseNameForId(assignment.getFamilyId(), assignment.getFamilyName());
            if (candidate != null && !candidate.isBlank() && bases.stream().noneMatch(x -> x.equalsIgnoreCase(candidate))) {
                bases.add(candidate);
            }
        }
        return bases;
    }

    private boolean canAccessMember(User actor, User member) {
        if (actor == null || member == null) return false;

        String role = normRole(actor.getRole());
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) return true;

        List<String> memberBases = memberBasesOf(member);

        if ("AMIN_OSRA".equals(role)) {
            return servingBasesOf(actor).stream().anyMatch(actorBase ->
                    memberBases.stream().anyMatch(memberBase -> actorBase.equalsIgnoreCase(memberBase)));
        }

        if ("KHADIM".equals(role)) {
            List<String> bases = servingBasesOf(actor);
            if (bases.stream().anyMatch(actorBase ->
                    memberBases.stream().anyMatch(memberBase -> actorBase.equalsIgnoreCase(memberBase)))) {
                return true;
            }

            // choir access
            String attend = member.getAttendKhors() == null ? "" : member.getAttendKhors().trim().toUpperCase(Locale.ROOT);
            String k = actor.getKhors() == null ? "" : actor.getKhors().trim().toUpperCase(Locale.ROOT);
            String scope = actor.getServingScope() == null ? "" : actor.getServingScope().trim().toUpperCase(Locale.ROOT);
            boolean servesChoir = "KHORS_ONLY".equals(scope) || "BOTH".equals(scope);
            if (servesChoir) {
                if ("BOTH".equals(k)) {
                    return "MARMARKOS".equals(attend) || "ATHANASIUS".equals(attend) || "BOTH".equals(attend);
                }
                return !k.isBlank() && (k.equalsIgnoreCase(attend) || "BOTH".equals(attend));
            }
        }

        return false;
    }

    private boolean canModifyVisit(User actor, IftekadVisit v) {
        if (actor == null || v == null) return false;
        String role = normRole(actor.getRole());
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) return true;
        return v.getRecordedBy() != null && actor.getId() != null && actor.getId().equals(v.getRecordedBy().getId());
    }

    private Map<String, Object> toDto(IftekadVisit v) {
        Map<String, Object> dto = new LinkedHashMap<>();
        dto.put("id", v.getId());
        dto.put("memberId", v.getMember() == null ? null : v.getMember().getId());
        dto.put("visitDate", v.getVisitDate());
        dto.put("description", v.getDescription());
        dto.put("companions", v.getCompanions());
        dto.put("createdAt", v.getCreatedAt());

        User rb = v.getRecordedBy();
        if (rb != null) {
            dto.put("recordedBy", Map.of(
                    "id", rb.getId(),
                    "fullName", rb.getFullName(),
                    "role", rb.getRole()
            ));
        } else {
            dto.put("recordedBy", null);
        }
        return dto;
    }

    @PostMapping("/visits")
    public ResponseEntity<?> create(@RequestBody IftekadVisitCreateRequest req, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        if (req == null || req.getMemberId() == null || req.getDate() == null || req.getDate().trim().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "memberId and date are required");
        }

        User member = userRepo.findById(req.getMemberId())
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Member not found"));

        if (!canAccessMember(me, member)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        LocalDate d;
        try {
            d = LocalDate.parse(req.getDate().trim());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid date format. Expected yyyy-MM-dd");
        }

        IftekadVisit v = IftekadVisit.builder()
                .member(member)
                .visitDate(d)
                .description(req.getDescription() == null ? null : req.getDescription().trim())
                .companions(req.getCompanions() == null ? null : req.getCompanions().trim())
                .recordedBy(me)
                .build();

        v = iftekadRepo.save(v);
        return ResponseEntity.ok(toDto(v));
    }

    @GetMapping("/visits")
    public ResponseEntity<?> list(@RequestParam Long memberId, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        if (memberId == null) throw new ApiException(HttpStatus.BAD_REQUEST, "memberId is required");

        User member = userRepo.findById(memberId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Member not found"));

        if (!canAccessMember(me, member)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        }

        List<IftekadVisit> visits = iftekadRepo.findByMemberIdWithRecordedByOrderByVisitDateDesc(memberId);
        List<Map<String, Object>> out = new ArrayList<>();
        for (IftekadVisit v : visits) out.add(toDto(v));

        return ResponseEntity.ok(out);
    }

    @PutMapping("/visits/{id}")
    public ResponseEntity<?> update(@PathVariable Long id, @RequestBody IftekadVisitUpdateRequest req, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        if (id == null) throw new ApiException(HttpStatus.BAD_REQUEST, "id is required");
        if (req == null || req.getDate() == null || req.getDate().trim().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "date is required");
        }

        IftekadVisit v = iftekadRepo.findByIdWithMemberAndRecordedBy(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Visit not found"));

        if (!canAccessMember(me, v.getMember())) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        if (!canModifyVisit(me, v)) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");

        LocalDate d;
        try {
            d = LocalDate.parse(req.getDate().trim());
        } catch (Exception e) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "Invalid date format. Expected yyyy-MM-dd");
        }

        v.setVisitDate(d);
        v.setDescription(req.getDescription() == null ? null : req.getDescription().trim());
        v.setCompanions(req.getCompanions() == null ? null : req.getCompanions().trim());

        v = iftekadRepo.save(v);
        return ResponseEntity.ok(toDto(v));
    }

    @DeleteMapping("/visits/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        IftekadVisit v = iftekadRepo.findByIdWithMemberAndRecordedBy(id)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "Visit not found"));

        if (!canAccessMember(me, v.getMember())) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");
        if (!canModifyVisit(me, v)) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");

        iftekadRepo.deleteById(id);
        return ResponseEntity.ok(Map.of("message", "deleted", "id", id));
    }

    @GetMapping("/last")
    public ResponseEntity<?> last(@RequestParam(name = "memberIds") String memberIds, Authentication auth) {
        if (auth == null) return ResponseEntity.status(401).body(Map.of("error", "Unauthorized"));

        User me = userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));

        if (memberIds == null || memberIds.trim().isBlank()) {
            return ResponseEntity.ok(Map.of());
        }

        List<Long> ids = new ArrayList<>();
        for (String p : memberIds.split(",")) {
            String s = p == null ? "" : p.trim();
            if (s.isBlank()) continue;
            try { ids.add(Long.valueOf(s)); } catch (Exception ignored) {}
        }
        if (ids.isEmpty()) return ResponseEntity.ok(Map.of());

        Map<Long, User> members = new LinkedHashMap<>();
        for (Long id : ids) {
            if (id == null) continue;
            userRepo.findById(id).ifPresent(u -> {
                if (canAccessMember(me, u)) members.put(id, u);
            });
        }
        if (members.isEmpty()) return ResponseEntity.ok(Map.of());

        List<Long> allowedIds = new ArrayList<>(members.keySet());
        List<IftekadVisitRepository.LastVisitProjection> rows = iftekadRepo.findLastVisitDates(allowedIds);

        Map<String, Object> out = new LinkedHashMap<>();
        for (IftekadVisitRepository.LastVisitProjection r : rows) {
            if (r == null || r.getMemberId() == null) continue;
            out.put(String.valueOf(r.getMemberId()), r.getLastDate());
        }
        return ResponseEntity.ok(out);
    }
}
