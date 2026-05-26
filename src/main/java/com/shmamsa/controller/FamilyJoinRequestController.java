package com.shmamsa.controller;

import com.shmamsa.dto.FamilyDecisionRequest;
import com.shmamsa.dto.FamilyJoinRequestView;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.FamilyJoinRequest;
import com.shmamsa.model.FamilyJoinRequestStatus;
import com.shmamsa.model.FamilyCatalog;
import com.shmamsa.model.User;
import com.shmamsa.repository.FamilyCatalogRepository;
import com.shmamsa.repository.FamilyJoinRequestRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.service.FamilyAccessService;
import com.shmamsa.service.FamilyJoinRequestService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/family-requests")
@RequiredArgsConstructor
public class FamilyJoinRequestController {

    private final UserRepository userRepo;
    private final FamilyCatalogRepository familyRepo;
    private final FamilyJoinRequestService requestService;
    private final FamilyJoinRequestRepository requestRepo;
    private final FamilyAccessService familyAccessService;

    private User me(Authentication auth) {
        if (auth == null) throw new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized");
        return userRepo.findByUsername(auth.getName())
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "Unauthorized"));
    }

    @GetMapping("/my-status")
    public ResponseEntity<?> myStatus(Authentication auth) {
        User user = me(auth);
        List<FamilyJoinRequest> all = requestRepo.findByUser_IdAndStatusNot(user.getId(), FamilyJoinRequestStatus.APPROVED);
        String status = "NONE";
        Long familyId = null;
        String familyName = null;
        for (FamilyJoinRequest r : all) {
            Long fid = r.getFamilyId();
            if (fid == null) continue;
            if (r.getStatus() == FamilyJoinRequestStatus.PENDING) {
                status = "PENDING";
                familyId = fid;
                FamilyCatalog f = familyRepo.findById(fid).orElse(null);
                familyName = f == null ? null : f.getNameAr();
                break;
            }
            if (r.getStatus() == FamilyJoinRequestStatus.REJECTED) {
                status = "REJECTED";
                familyId = fid;
                FamilyCatalog f = familyRepo.findById(fid).orElse(null);
                familyName = f == null ? null : f.getNameAr();
            }
        }
        return ResponseEntity.ok(Map.of("status", status, "familyId", familyId, "familyName", familyName));
    }

    @PostMapping
    public ResponseEntity<?> submitRequest(@RequestBody Map<String, Long> body, Authentication auth) {
        User user = me(auth);
        Long familyId = body.get("familyId");
        if (familyId == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "FAMILY_REQUIRED", "Family ID is required");
        }
        FamilyJoinRequest req = requestService.createRequest(user, familyId);
        return ResponseEntity.ok(Map.of("id", req.getId(), "status", req.getStatus().name()));
    }

    @GetMapping("/pending/count")
    public ResponseEntity<?> pendingCount(Authentication auth) {
        User admin = me(auth);
        long c = requestService.pendingCountForFamilyAdmin(admin);
        return ResponseEntity.ok(Map.of("count", c));
    }

    @GetMapping("/pending")
    public ResponseEntity<?> pending(Authentication auth) {
        User admin = me(auth);
        List<FamilyJoinRequestView> out = requestService.getPendingViews(admin);
        return ResponseEntity.ok(out);
    }

    @PostMapping("/{id}/decision")
    public ResponseEntity<?> decide(@PathVariable Long id, @RequestBody FamilyDecisionRequest body, Authentication auth) {
        User admin = me(auth);
        requestService.decide(admin, id, body.approved());
        return ResponseEntity.ok(Map.of("ok", true));
    }
}
