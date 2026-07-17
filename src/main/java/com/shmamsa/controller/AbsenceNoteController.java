package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.AbsenceNote;
import com.shmamsa.model.User;
import com.shmamsa.repository.AbsenceNoteRepository;
import com.shmamsa.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/attendance/absence-notes")
@RequiredArgsConstructor
public class AbsenceNoteController {

    private final AbsenceNoteRepository noteRepo;
    private final UserRepository userRepo;

    private User me(Authentication auth) {
        if (auth == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    /** GET /api/attendance/absence-notes?familyBase=&date= */
    @GetMapping
    public ResponseEntity<?> list(
            @RequestParam String familyBase,
            @RequestParam String date,
            Authentication auth) {
        me(auth);
        LocalDate d = LocalDate.parse(date);
        List<AbsenceNote> notes = noteRepo.findByFamilyBaseAndDate(familyBase, d);
        List<Map<String, Object>> out = notes.stream().map(this::toView).collect(Collectors.toList());
        return ResponseEntity.ok(out);
    }

    /** POST /api/attendance/absence-notes
     *  Body: { memberId, date, attendanceType, note, familyBase }
     *  If note is blank → deletes the record (clear excuse)
     */
    @PostMapping
    public ResponseEntity<?> upsert(@RequestBody Map<String, Object> body, Authentication auth) {
        User actor = me(auth);
        String role = normRole(actor.getRole());
        boolean canWrite = List.of("KHADIM", "AMIN_OSRA", "AMIN_KHEDMA", "DEVELOPER").contains(role);
        if (!canWrite) throw new ApiException(HttpStatus.FORBIDDEN, "Forbidden");

        Long memberId = toLong(body.get("memberId"));
        String dateStr = (String) body.get("date");
        String attendanceType = (String) body.get("attendanceType");
        String note = body.get("note") != null ? body.get("note").toString().trim() : "";
        String familyBase = body.get("familyBase") != null ? body.get("familyBase").toString() : null;

        if (memberId == null || dateStr == null || attendanceType == null)
            throw new ApiException(HttpStatus.BAD_REQUEST, "memberId, date and attendanceType are required");

        LocalDate date = LocalDate.parse(dateStr);

        Optional<AbsenceNote> existing = noteRepo.findByMemberIdAndDateAndAttendanceType(memberId, date, attendanceType);

        if (note.isBlank()) {
            existing.ifPresent(noteRepo::delete);
            return ResponseEntity.ok(Map.of("deleted", existing.isPresent()));
        }

        AbsenceNote n = existing.orElse(new AbsenceNote());
        n.setMemberId(memberId);
        n.setDate(date);
        n.setAttendanceType(attendanceType);
        n.setNote(note);
        n.setTakenBy(actor);
        n.setFamilyBase(familyBase);
        noteRepo.save(n);

        return ResponseEntity.ok(toView(n));
    }

    private Map<String, Object> toView(AbsenceNote n) {
        Map<String, Object> m = new LinkedHashMap<>();
        m.put("id", n.getId());
        m.put("memberId", n.getMemberId());
        m.put("date", n.getDate().toString());
        m.put("attendanceType", n.getAttendanceType());
        m.put("note", n.getNote());
        m.put("familyBase", n.getFamilyBase());
        m.put("takenBy", n.getTakenBy() != null ? n.getTakenBy().getFullName() : null);
        return m;
    }

    private static String normRole(String raw) {
        if (raw == null) return "";
        return raw.trim().replace("ROLE_", "").toUpperCase();
    }

    private static Long toLong(Object v) {
        if (v == null) return null;
        if (v instanceof Number) return ((Number) v).longValue();
        try { return Long.parseLong(v.toString()); } catch (Exception e) { return null; }
    }
}
