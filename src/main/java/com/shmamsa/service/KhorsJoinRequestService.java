package com.shmamsa.service;

import com.shmamsa.exception.ApiException;
import com.shmamsa.model.KhorsJoinRequest;
import com.shmamsa.model.KhorsJoinRequestStatus;
import com.shmamsa.model.User;
import com.shmamsa.repository.KhorsJoinRequestRepository;
import com.shmamsa.repository.UserRepository;
import com.shmamsa.security.RoleUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

@Service
@RequiredArgsConstructor
public class KhorsJoinRequestService {

    private final KhorsJoinRequestRepository repo;
    private final UserRepository userRepository;

    private static String normKhors(String v) {
        String x = (v == null) ? "" : v.trim().toUpperCase(Locale.ROOT);
        if (x.isBlank()) return "NONE";
        return x;
    }

    @Transactional
    public void createForUserIfNeeded(User user, String requestedKhors) {
        String k = normKhors(requestedKhors);
        if ("NONE".equals(k) || k.isBlank()) return;
        if (!("MARMARKOS".equals(k) || "ATHANASIUS".equals(k))) {
            // Self-registration can only request 1 choir
            return;
        }

        repo.findFirstByUser_IdAndStatus(user.getId(), KhorsJoinRequestStatus.PENDING)
                .ifPresent(existing -> {
                    throw new ApiException(HttpStatus.CONFLICT, "REQUEST_ALREADY_PENDING", "There is already a pending choir request");
                });

        KhorsJoinRequest r = KhorsJoinRequest.builder()
                .user(user)
                .requestedKhors(k)
                .status(KhorsJoinRequestStatus.PENDING)
                .createdAt(LocalDateTime.now())
                .build();

        repo.save(r);
    }

    /** Returns the list of khors the actor can moderate. Empty list means none. */
    public List<String> moderatableKhors(User actor) {
        if (actor == null) return List.of();
        String role = String.valueOf(actor.getRole()).toUpperCase(Locale.ROOT);


        if (RoleUtil.isAtLeast(role, "AMIN_KHEDMA")) {
            return List.of("MARMARKOS", "ATHANASIUS");
        }

        if ("KHADIM".equals(role)) {
            String scope = (actor.getServingScope() == null) ? "" : actor.getServingScope().trim().toUpperCase(Locale.ROOT);
            if (!("KHORS_ONLY".equals(scope) || "BOTH".equals(scope))) {
                return List.of();
            }

            String k = normKhors(actor.getKhors());
            if ("BOTH".equals(k)) return List.of("MARMARKOS", "ATHANASIUS");
            if ("MARMARKOS".equals(k) || "ATHANASIUS".equals(k)) return List.of(k);
        }

        return List.of();
    }

    public long pendingCountFor(User actor) {
        List<String> allowed = moderatableKhors(actor);
        if (allowed.isEmpty()) return 0;
        if (allowed.size() == 2) {
            return repo.countByStatus(KhorsJoinRequestStatus.PENDING);
        }
        return repo.countByStatusAndRequestedKhorsIn(KhorsJoinRequestStatus.PENDING, allowed);
    }

    public List<KhorsJoinRequest> pendingRequestsFor(User actor) {
        List<String> allowed = moderatableKhors(actor);
        if (allowed.isEmpty()) return List.of();

        if (allowed.size() == 2) {
            return repo.findByStatusFetchUser(KhorsJoinRequestStatus.PENDING);
        }

        return repo.findByStatusAndRequestedKhorsInFetchUser(KhorsJoinRequestStatus.PENDING, allowed);
    }

    @Transactional
    public void decide(User actor, Long requestId, boolean approve) {
        List<String> allowed = moderatableKhors(actor);
        if (allowed.isEmpty()) {
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_ALLOWED", "You are not allowed to moderate choir requests");
        }

        KhorsJoinRequest r = repo.findById(requestId)
                .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "Request not found"));

        if (r.getStatus() != KhorsJoinRequestStatus.PENDING) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "REQUEST_NOT_PENDING", "Request is not pending");
        }

        String reqKhors = normKhors(r.getRequestedKhors());
        if (!(allowed.size() == 2 || allowed.contains(reqKhors))) {
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_ALLOWED_FOR_THIS_KHORS", "You cannot moderate this choir");
        }

        r.setDecidedAt(LocalDateTime.now());
        r.setDecidedBy(actor);

        if (approve) {
            r.setStatus(KhorsJoinRequestStatus.APPROVED);

            User target = userRepository.findById(r.getUser().getId())
                    .orElseThrow(() -> new ApiException(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "User not found"));

            // If the user is a servant (KHADIM) serving families فقط and asked to "attend" a choir,
            // we approve by setting attendKhors.
            String targetRole = String.valueOf(target.getRole()).toUpperCase(Locale.ROOT);
            String scope = (target.getServingScope() == null) ? "" : target.getServingScope().trim().toUpperCase(Locale.ROOT);

            if ("KHADIM".equals(targetRole) && "FAMILY_ONLY".equals(scope)) {
                target.setAttendKhors(reqKhors);
            } else {
                // default: join as choir member
                target.setKhors(reqKhors);
                target.setKhorsYear(1);
            }

            userRepository.save(target);
        } else {
            r.setStatus(KhorsJoinRequestStatus.REJECTED);
        }

        repo.save(r);
    }
}
