package com.shmamsa.service;

import com.shmamsa.dto.FamilyJoinRequestView;
import com.shmamsa.exception.ApiException;
import com.shmamsa.model.*;
import com.shmamsa.repository.FamilyJoinRequestRepository;
import com.shmamsa.repository.FamilyCatalogRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.repository.UserFamilyRoleRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class FamilyJoinRequestService {

    private final FamilyJoinRequestRepository requestRepo;
    private final FamilyCatalogRepository familyRepo;
    private final UserRepository userRepo;
    private final UserFamilyRoleRepository userFamilyRoleRepo;
    private final FamilyAccessService familyAccessService;

    private static final Set<String> KNOWN_SCHOOL_GRADES = Set.of(
            "أولى ابتدائي", "تانية ابتدائي", "تالتة ابتدائي", "رابعة ابتدائي", "خامسة ابتدائي", "سادسة ابتدائي",
            "أولى إعدادي", "تانية إعدادي", "تالتة إعدادي",
            "أولى ثانوي", "تانية ثانوي", "تالتة ثانوي",
            "other"
    );

    public boolean canJoinDirectly(User user, FamilyCatalog family) {
        if (family.getDirectJoinGrades() == null || family.getDirectJoinGrades().isBlank()) {
            return true;
        }
        LocalDate today = LocalDate.now();
        if (family.getDirectJoinFrom() != null && today.isBefore(family.getDirectJoinFrom())) {
            return false;
        }
        if (family.getDirectJoinUntil() != null && today.isAfter(family.getDirectJoinUntil())) {
            return false;
        }
        String userGrade = user.getSchoolGrade();
        if (userGrade == null || userGrade.isBlank()) {
            return false;
        }
        for (String grade : family.getDirectJoinGrades().split(",")) {
            if (grade.trim().equalsIgnoreCase(userGrade.trim())) {
                return true;
            }
        }
        return false;
    }

    @Transactional
    public FamilyJoinRequest createRequest(User user, Long familyId) {
        FamilyCatalog family = familyRepo.findById(familyId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "FAMILY_NOT_FOUND", "Family not found"));

        if (!Boolean.TRUE.equals(family.getActive())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "FAMILY_INACTIVE", "Family is not active");
        }

        if (requestRepo.existsByUserIdAndFamilyIdAndStatus(user.getId(), familyId, FamilyJoinRequestStatus.PENDING)) {
            throw new ApiException(HttpStatus.CONFLICT, "ALREADY_PENDING", "You already have a pending request for this family");
        }

        FamilyJoinRequest req = FamilyJoinRequest.builder()
                .user(user)
                .familyId(familyId)
                .status(FamilyJoinRequestStatus.PENDING)
                .createdAt(LocalDateTime.now())
                .build();
        return requestRepo.save(req);
    }

    public List<FamilyJoinRequest> pendingRequestsForFamilyAdmin(User admin) {
        String role = admin.getRole() == null ? "" : admin.getRole().trim().toUpperCase();
        if ("DEVELOPER".equals(role) || "AMIN_KHEDMA".equals(role)) {
            return requestRepo.findByStatusOrderByCreatedAtAsc(FamilyJoinRequestStatus.PENDING);
        }
        List<Long> adminFamilyIds = userFamilyRoleRepo.findByUser_IdOrderByAssignmentOrderAscIdAsc(admin.getId()).stream()
                .filter(ufr -> ufr.getRoleCode() != null && ufr.getRoleCode() <= 2)
                .map(UserFamilyRole::getFamilyId)
                .filter(id -> id != null)
                .distinct()
                .toList();
        if (adminFamilyIds.isEmpty()) {
            return List.of();
        }
        return requestRepo.findByStatusOrderByCreatedAtAsc(FamilyJoinRequestStatus.PENDING).stream()
                .filter(r -> adminFamilyIds.contains(r.getFamilyId()))
                .toList();
    }

    @Transactional(readOnly = true)
    public List<FamilyJoinRequestView> getPendingViews(User admin) {
        return pendingRequestsForFamilyAdmin(admin).stream().map(r -> {
            User u = r.getUser();
            FamilyCatalog f = familyRepo.findById(r.getFamilyId()).orElse(null);
            return FamilyJoinRequestView.builder()
                    .requestId(r.getId())
                    .userId(u == null ? null : u.getId())
                    .fullName(u == null ? "Unknown" : u.getFullName())
                    .username(u == null ? "" : u.getUsername())
                    .deaconFamily(u == null ? "-" : familyAccessService.primaryFamilyName(u))
                    .role(u == null ? "-" : u.getRole())
                    .familyId(r.getFamilyId())
                    .familyName(f == null ? "Unknown" : f.getNameAr())
                    .status(r.getStatus().name())
                    .createdAt(r.getCreatedAt() == null ? null : r.getCreatedAt().toString())
                    .build();
        }).toList();
    }

    public long pendingCountForFamilyAdmin(User admin) {
        return pendingRequestsForFamilyAdmin(admin).size();
    }

    @Transactional
    public void decide(User admin, Long requestId, boolean approved) {
        FamilyJoinRequest req = requestRepo.findById(requestId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "Request not found"));

        if (req.getStatus() != FamilyJoinRequestStatus.PENDING) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "ALREADY_DECIDED", "Request has already been decided");
        }

        if (approved) {
            User user = req.getUser();
            if (user == null) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "USER_NOT_FOUND", "User not found");
            }
            Long familyId = req.getFamilyId();
            int order = userFamilyRoleRepo.findByUser_IdOrderByAssignmentOrderAscIdAsc(user.getId()).size() + 1;
            UserFamilyRole ufr = UserFamilyRole.builder()
                    .user(user)
                    .familyId(familyId)
                    .roleCode(4)
                    .assignmentOrder(order)
                    .build();
            userFamilyRoleRepo.save(ufr);
        }

        req.setStatus(approved ? FamilyJoinRequestStatus.APPROVED : FamilyJoinRequestStatus.REJECTED);
        req.setDecidedAt(LocalDateTime.now());
        req.setDecidedBy(admin);
        requestRepo.save(req);
    }

    public boolean hasPendingRequest(Long userId, Long familyId) {
        return requestRepo.existsByUserIdAndFamilyIdAndStatus(userId, familyId, FamilyJoinRequestStatus.PENDING);
    }

    public List<FamilyJoinRequest> getUserRequests(User user) {
        return requestRepo.findByFamilyIdAndStatusOrderByCreatedAtAsc(user.getId(), FamilyJoinRequestStatus.PENDING);
    }
}
