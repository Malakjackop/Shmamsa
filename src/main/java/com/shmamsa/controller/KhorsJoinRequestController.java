package com.shmamsa.controller;

import com.shmamsa.dto.KhorsDecisionRequest;
import com.shmamsa.dto.KhorsJoinRequestView;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.KhorsJoinRequest;
import com.shmamsa.model.User;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.KhorsJoinRequestService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/khors-requests")
@RequiredArgsConstructor
public class KhorsJoinRequestController {

    private final UserRepository userRepo;
    private final KhorsJoinRequestService service;

    private User me(Authentication auth) {
        if (auth == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    @GetMapping("/pending/count")
    public ResponseEntity<?> pendingCount(Authentication auth) {
        User actor = me(auth);
        long c = service.pendingCountFor(actor);
        return ResponseEntity.ok(Map.of("count", c));
    }

    @GetMapping("/pending")
    public ResponseEntity<?> pending(Authentication auth) {
        User actor = me(auth);
        List<KhorsJoinRequest> list = service.pendingRequestsFor(actor);
        List<KhorsJoinRequestView> out = list.stream().map(r ->
        {
            User u = r.getUser();
            if (u == null) {
                return KhorsJoinRequestView.builder()
                        .requestId(r.getId())
                        .userId(null)
                        .fullName("Unknown user")
                        .deaconFamily("-")
                        .role("-")
                        .requestedKhors(r.getRequestedKhors())
                        .createdAt(r.getCreatedAt() == null ? null : r.getCreatedAt().toString())
                        .build();
            }
            return
                KhorsJoinRequestView.builder()
                        .requestId(r.getId())
                        .userId(u.getId())
                        .fullName(u.getFullName())
                        .deaconFamily(u.getDeaconFamily())
                        .role(u.getRole())
                        .requestedKhors(r.getRequestedKhors())
                        .createdAt(r.getCreatedAt() == null ? null : r.getCreatedAt().toString())
                        .build();
        }).toList();
        return ResponseEntity.ok(out);
    }

    @PostMapping("/{id}/decision")
    public ResponseEntity<?> decide(
            @PathVariable("id") Long id,
            @RequestBody KhorsDecisionRequest body,
            Authentication auth
    ) {
        User actor = me(auth);
        service.decide(actor, id, body.isApproved());
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
