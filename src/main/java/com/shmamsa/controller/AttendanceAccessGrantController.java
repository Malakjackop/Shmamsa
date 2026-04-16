package com.shmamsa.controller;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.AttendanceAccessGrantService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.security.core.Authentication;

import java.util.Map;

@RestController
@RequestMapping("/api/attendance/access-grants")
@RequiredArgsConstructor
public class AttendanceAccessGrantController {

    private final AttendanceAccessGrantService attendanceAccessGrantService;
    private final UserRepository userRepository;

    private User requireActor(Authentication auth) {
        if (auth == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized");
        }
        return userRepository.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized"));
    }

    @GetMapping
    public ResponseEntity<?> list(Authentication auth) {
        User actor = requireActor(auth);
        return ResponseEntity.ok(attendanceAccessGrantService.listManageableGrants(actor)
                .stream()
                .map(attendanceAccessGrantService::toView)
                .toList());
    }

    @PostMapping
    public ResponseEntity<?> create(@RequestBody AttendanceAccessGrantService.GrantRequest req, Authentication auth) {
        User actor = requireActor(auth);
        return ResponseEntity.ok(attendanceAccessGrantService.toView(attendanceAccessGrantService.createGrant(actor, req)));
    }

    @PutMapping("/{id}")
    public ResponseEntity<?> update(@PathVariable Long id,
                                    @RequestBody AttendanceAccessGrantService.GrantRequest req,
                                    Authentication auth) {
        User actor = requireActor(auth);
        return ResponseEntity.ok(attendanceAccessGrantService.toView(attendanceAccessGrantService.updateGrant(actor, id, req)));
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<?> delete(@PathVariable Long id, Authentication auth) {
        User actor = requireActor(auth);
        attendanceAccessGrantService.deleteGrant(actor, id);
        return ResponseEntity.ok(Map.of("ok", true, "id", id));
    }
}